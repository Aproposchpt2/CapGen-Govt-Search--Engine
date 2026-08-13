'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { candidateKey, verifyCandidateCapabilities } = require('./lib/ngcc-contractor-capability-verification');
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
    const verification = shouldVerify
      ? await verifyCandidateCapabilities(candidates, contractDna, { limit: 20 })
      : { status: 'SKIPPED', verifications: new Map(), error: null };

    const enriched = candidates.map(candidate => ({
      ...candidate,
      capability_verification: verification.verifications.get(candidateKey(candidate)) || candidate.capability_verification || null,
    }));

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
      ranked_candidates: ranked,
      qualification_policy: 'SAM/NAICS evidence establishes discovery relevance only. Contract Qualification is scored only when current capability evidence is affirmatively supported and minimum evidence coverage is reached. Missing evidence remains INSUFFICIENT_EVIDENCE; it is never converted into a false 50% fit score.',
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
