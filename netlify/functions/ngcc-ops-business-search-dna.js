'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { buildBusinessSearchDna } = require('./lib/ngcc-procurement-dna');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid request body.' });
  }

  const contractDna = body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null;
  if (!contractDna || !contractDna.notice_id) {
    return json(400, { ok: false, error: 'contract_dna with notice_id is required.' });
  }

  if (contractDna.search_readiness !== 'READY') {
    return json(409, {
      ok: false,
      stage: 'BUSINESS_SEARCH_DNA',
      status: 'BLOCKED',
      error: 'Contract DNA is not search-ready. Resolve Stage 02 before advancing.',
    });
  }

  const businessSearchDna = buildBusinessSearchDna(contractDna);
  return json(200, {
    ok: true,
    stage: 'BUSINESS_SEARCH_DNA',
    status: businessSearchDna.search_readiness === 'READY' ? 'SUCCESS' : 'WAITING',
    next_stage: businessSearchDna.search_readiness === 'READY' ? 'SAM_CONTRACTOR_DISCOVERY' : null,
    business_search_dna: businessSearchDna,
  });
};
