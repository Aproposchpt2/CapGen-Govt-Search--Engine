'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { buildContractDna } = require('./lib/ngcc-procurement-dna');

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

  const opportunity = body.opportunity && typeof body.opportunity === 'object' ? body.opportunity : {};
  const derivation = body.derivation && typeof body.derivation === 'object' ? body.derivation : {};
  const requirements = body.requirements && typeof body.requirements === 'object' ? body.requirements : {};
  const noticeId = String(opportunity.noticeId || opportunity.notice_id || '').trim();
  const title = String(opportunity.title || '').trim();

  if (!noticeId || !title) {
    return json(400, { ok: false, error: 'opportunity.noticeId and opportunity.title are required.' });
  }

  const contractDna = buildContractDna({ opportunity, derivation, requirements });
  return json(200, {
    ok: true,
    stage: 'CONTRACT_DNA',
    status: contractDna.search_readiness === 'READY' ? 'SUCCESS' : 'WAITING',
    next_stage: contractDna.search_readiness === 'READY' ? 'BUSINESS_SEARCH_DNA' : null,
    contract_dna: contractDna,
  });
};
