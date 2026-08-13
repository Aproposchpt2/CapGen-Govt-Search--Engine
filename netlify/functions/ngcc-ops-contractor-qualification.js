'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const {
  candidateKey,
  emptyVerification,
  normalizeVerificationLimit,
  verifyCandidateCapabilities,
} = require('./lib/ngcc-contractor-capability-verification');
const { rankCandidates, qualificationSummary } = require('./lib/ngcc-contractor-qualification');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const candidates = Array.isArray(body.candidates) ? body.candidates : null;
  const contractDna = body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null;
  const businessSearchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;

  if (!candidates) return json(400, { ok: false, error: 'candidates array is required.' });
  if (!contractDna) return json(400, { ok: false, error: 'contract_dna is required.' });
  if (!businessSearchDna) return json(400, { ok: false, error: 'business_search_dna is required.' });
  if (businessSearchDna.search_readiness !== 'READY') {
    return json(409, { ok: false, stage: 'CONTRACTOR_QUALIFICATION', status: 'BLOCKED', error: 'Business Search DNA is not READY.' });
  }

  try {
    const shouldVerify = body.verify_capabilities !== false;
    const verificationLimit = normalizeVerificationLimit(body.capability_verification_limit);

    // First rank only the discovery evidence. That creates the bounded research
    // queue without allowing a slow public-web search across the full Stage 04
    // population to block this synchronous operator action.
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
      ? await verifyCandidateCapabilities(verificationTargets, contractDna, { limit: verificationLimit })
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
    return json(200, {
      ok: true,
      stage: 'CONTRACTOR_QUALIFICATION',
      status: ranked.length ? 'SUCCESS' : 'ZERO_RESULT',
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
      ranked_candidates: ranked,
      qualification_policy: 'SAM/NAICS evidence establishes discovery relevance only. Contract Qualification is scored only when current capability evidence is affirmatively supported and minimum evidence coverage is reached. Missing, deferred, or timeboxed evidence remains INSUFFICIENT_EVIDENCE; it is never converted into a false 50% fit score.',
      persistence: 'NONE — qualification results belong to the active mission execution state only',
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