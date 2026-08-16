'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { buildContractDna } = require('./lib/ngcc-procurement-dna');
const { buildContractIntelligence } = require('./lib/ngcc-contract-intelligence');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const opportunity = body.opportunity && typeof body.opportunity === 'object' ? body.opportunity : {};
  const noticeId = String(opportunity.noticeId || opportunity.notice_id || '').trim();
  const title = String(opportunity.title || '').trim();
  if (!noticeId || !title) return json(400, { ok: false, error: 'opportunity.noticeId and opportunity.title are required.' });

  try {
    let derivation = body.derivation && typeof body.derivation === 'object' ? body.derivation : null;
    let requirements = body.requirements && typeof body.requirements === 'object' ? body.requirements : null;
    let intelligence = null;

    // Normal Stage 02 execution: derive from the selected live SAM opportunity.
    // Supplying derivation/requirements is retained only for controlled testing/replay.
    if (!derivation || !requirements || body.execute_intelligence === true) {
      intelligence = await buildContractIntelligence(opportunity);
      derivation = intelligence.derivation;
      requirements = intelligence.requirements;
    }

    const contractDna = buildContractDna({ opportunity, derivation: derivation || {}, requirements: requirements || {} });
    return json(200, {
      ok: true,
      stage: 'CONTRACT_DNA',
      status: contractDna.search_readiness === 'READY' ? 'SUCCESS' : 'WAITING',
      next_stage: contractDna.search_readiness === 'READY' ? 'BUSINESS_SEARCH_DNA' : null,
      contract_dna: contractDna,
      execution_evidence: intelligence ? {
        requirements_source: 'SAM.gov solicitation description',
        requirements_evidence_used: intelligence.description_used,
        source_retrieval_error: intelligence.description_error,
        naics_search_expansion: contractDna.classification.naics_search_paths,
      } : { replay_input: true },
    });
  } catch (error) {
    console.error('[ngcc-ops-contract-dna]', error);
    return json(200, {
      ok: false,
      stage: 'CONTRACT_DNA',
      status: 'FAILED',
      error: String(error?.message || 'Contract DNA execution failed.'),
    });
  }
};
