'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const {
  candidateKey,
  emptyVerification,
  normalizeVerificationLimit,
  verifyCandidateCapabilities,
} = require('./lib/ngcc-contractor-capability-verification');
const { rankCandidates, qualificationSummary } = require('./lib/ngcc-contractor-qualification');
const {
  currentRun,
  listCandidates,
  persistQualifications,
  updateSearchRun,
} = require('./lib/ngcc-contractor-store');

const HARD_RESPONSE_TIMEBOX_MS = 18000;

function timeoutVerification(targets, verificationLimit) {
  const note = `Current public capability verification did not complete within the ${HARD_RESPONSE_TIMEBOX_MS} ms Stage 05 response timebox; unresolved evidence remains UNVERIFIED.`;
  return {
    status: 'TIMEBOX_EXCEEDED',
    verifications: new Map((targets || []).map(candidate => [candidateKey(candidate), emptyVerification(candidate, 'TIMEBOX_EXCEEDED', note)])),
    error: note,
    target_count: (targets || []).length,
    limit: verificationLimit,
    timeout_ms: HARD_RESPONSE_TIMEBOX_MS,
  };
}

async function runBoundedVerification(targets, contractDna, verificationLimit) {
  let timer;
  const verificationPromise = verifyCandidateCapabilities(targets, contractDna, {
    limit: verificationLimit,
    timeout_ms: 15000,
  }).catch(error => ({
    ...timeoutVerification(targets, verificationLimit),
    status: 'FAILED',
    error: String(error?.message || error || 'Capability verification failed.'),
  }));

  const hardTimeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(timeoutVerification(targets, verificationLimit)), HARD_RESPONSE_TIMEBOX_MS);
  });

  try {
    return await Promise.race([verificationPromise, hardTimeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const missionId = String(body.mission_id || '').trim();
  const contractDna = body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null;
  const businessSearchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;

  if (!contractDna) return json(400, { ok: false, error: 'contract_dna is required.' });
  if (!businessSearchDna) return json(400, { ok: false, error: 'business_search_dna is required.' });
  if (businessSearchDna.search_readiness !== 'READY') {
    return json(409, { ok: false, stage: 'CONTRACTOR_QUALIFICATION', status: 'BLOCKED', error: 'Business Search DNA is not READY.' });
  }

  try {
    let run = null;
    if (body.search_run_id) run = { id: String(body.search_run_id).trim() };
    else if (missionId) run = await currentRun(missionId);

    let candidates = run?.id ? await listCandidates({ searchRunId: run.id }) : [];
    if (!candidates.length && Array.isArray(body.candidates)) candidates = body.candidates;
    if (!candidates.length) return json(409, { ok: false, stage: 'CONTRACTOR_QUALIFICATION', status: 'BLOCKED', error: 'No Stage 04 contractor candidates are available to qualify.' });

    const shouldVerify = body.verify_capabilities !== false;
    const verificationLimit = normalizeVerificationLimit(body.capability_verification_limit);

    const discoveryRanked = rankCandidates({
      candidates: candidates.map(candidate => ({ ...candidate, capability_verification: null })),
      contractDna,
      businessSearchDna,
    });
    const targetKeys = new Set(discoveryRanked.slice(0, verificationLimit).map(candidateKey));
    const verificationTargets = candidates
      .filter(candidate => targetKeys.has(candidateKey(candidate)))
      .slice(0, verificationLimit);

    const verification = shouldVerify
      ? await runBoundedVerification(verificationTargets, contractDna, verificationLimit)
      : { status: 'SKIPPED', verifications: new Map(), error: null, target_count: 0, limit: verificationLimit, timeout_ms: null };

    const deferredNote = shouldVerify && candidates.length > verificationTargets.length
      ? `Deferred from this bounded public-evidence pass after the top ${verificationTargets.length} Discovery Match candidates were selected for live verification.`
      : null;

    const enriched = candidates.map(candidate => {
      const key = candidateKey(candidate);
      const liveVerification = verification.verifications.get(key);
      const wasTargeted = targetKeys.has(key) && shouldVerify;
      return {
        ...candidate,
        capability_verification: liveVerification || candidate.capability_verification || (
          deferredNote && !wasTargeted ? emptyVerification(candidate, 'DEFERRED', deferredNote) : null
        ),
      };
    });

    const ranked = rankCandidates({ candidates: enriched, contractDna, businessSearchDna });
    const summary = qualificationSummary(ranked);
    const durableRanked = run?.id ? await persistQualifications(run.id, ranked) : ranked;
    if (run?.id) {
      await updateSearchRun(run.id, {
        status: 'QUALIFIED',
        records_examined: candidates.length,
        records_accepted: summary.qualified + summary.review_required + summary.insufficient_evidence,
        records_rejected: summary.disqualified,
        completed_at: new Date().toISOString(),
      });
    }

    return json(200, {
      ok: true,
      stage: 'CONTRACTOR_QUALIFICATION',
      status: durableRanked.length ? 'SUCCESS' : 'ZERO_RESULT',
      search_run_id: run?.id || null,
      records_examined: candidates.length,
      records_accepted: summary.qualified + summary.review_required + summary.insufficient_evidence,
      records_rejected: summary.disqualified,
      summary,
      capability_verification_status: verification.status,
      capability_verification_error: verification.error || null,
      capability_verification_limit: verificationLimit,
      capability_verification_target_count: verificationTargets.length,
      capability_verification_timeout_ms: verification.timeout_ms ?? null,
      capability_verification_scope: shouldVerify
        ? `Current public capability research was bounded to the ${verificationTargets.length} highest Discovery Match candidate(s) for this synchronous Stage 05 pass. Remaining candidates stay UNVERIFIED/INSUFFICIENT_EVIDENCE until separately researched; they are not rejected for lack of evidence.`
        : 'Current public capability verification was explicitly skipped for this execution.',
      ranked_candidates: durableRanked,
      qualification_policy: 'SAM/NAICS evidence establishes discovery relevance only. Contract Qualification is scored only when current capability evidence is affirmatively supported and minimum evidence coverage is reached. Missing, deferred, or timeboxed evidence remains INSUFFICIENT_EVIDENCE; it is never converted into a false 50% fit score.',
      persistence: run?.id ? 'DURABLE — qualification updated the same contractor rows created by Stage 04.' : 'LEGACY FALLBACK — mission/search_run_id was not supplied.',
    });
  } catch (error) {
    console.error('[ngcc-ops-contractor-qualification]', error);
    return json(200, {
      ok: false,
      stage: 'CONTRACTOR_QUALIFICATION',
      status: 'FAILED',
      error: String(error?.message || 'Contractor qualification failed.'),
    });
  }
};

module.exports.HARD_RESPONSE_TIMEBOX_MS = HARD_RESPONSE_TIMEBOX_MS;
module.exports.timeoutVerification = timeoutVerification;
module.exports.runBoundedVerification = runBoundedVerification;
