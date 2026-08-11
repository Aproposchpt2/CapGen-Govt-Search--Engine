'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
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
    const ranked = rankCandidates({ candidates, contractDna, businessSearchDna });
    const summary = qualificationSummary(ranked);
    return json(200, {
      ok: true,
      stage: 'CONTRACTOR_QUALIFICATION',
      status: ranked.length ? 'SUCCESS' : 'ZERO_RESULT',
      records_examined: candidates.length,
      records_accepted: summary.qualified + summary.review_required,
      records_rejected: summary.disqualified,
      summary,
      ranked_candidates: ranked,
      qualification_policy: 'Unknown contract-specific eligibility evidence remains REVIEW_REQUIRED; it is never converted into a false qualification.',
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
