'use strict';

const { json, opsGuard, samEntitySearchByNaics } = require('./lib/ngcc-ops');
const { mergeDiscoveryBatch, finalizeCandidates } = require('./lib/ngcc-contractor-discovery');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const searchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;
  if (!searchDna) return json(400, { ok: false, error: 'business_search_dna is required.' });
  if (searchDna.search_readiness !== 'READY') {
    return json(409, { ok: false, stage: 'SAM_CONTRACTOR_DISCOVERY', status: 'BLOCKED', error: 'Business Search DNA is not READY.' });
  }

  const paths = Array.isArray(searchDna.retrieval?.naics_search_paths) ? searchDna.retrieval.naics_search_paths : [];
  if (!paths.length) return json(409, { ok: false, stage: 'SAM_CONTRACTOR_DISCOVERY', status: 'BLOCKED', error: 'No approved NAICS search paths exist.' });

  const cap = Math.max(1, Math.min(Number(body.limit || 20), 20));
  const state = String(body.state || '').trim().toUpperCase();
  const candidates = new Map();
  const execution = [];

  try {
    // Deliberately sequential. Search-path priority is preserved and the run
    // stops as soon as the controlled candidate cap is reached.
    for (const path of [...paths].sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))) {
      if (candidates.size >= cap) break;
      const remaining = cap - candidates.size;
      const result = await samEntitySearchByNaics({
        naicsCode: String(path.naics_code || '').trim(),
        state: state || undefined,
        limit: remaining,
      });
      const before = candidates.size;
      mergeDiscoveryBatch(candidates, result.entities, path, cap);
      execution.push({
        naics_code: path.naics_code,
        source: path.source,
        priority: path.priority,
        sam_total_records: result.totalRecords,
        returned: result.entities.length,
        unique_candidates_added: candidates.size - before,
      });
    }

    const output = finalizeCandidates(candidates);
    return json(200, {
      ok: true,
      stage: 'SAM_CONTRACTOR_DISCOVERY',
      status: output.length ? 'SUCCESS' : 'ZERO_RESULT',
      records_examined: execution.reduce((sum, run) => sum + Number(run.returned || 0), 0),
      records_accepted: output.length,
      records_rejected: Math.max(0, execution.reduce((sum, run) => sum + Number(run.returned || 0), 0) - output.length),
      candidate_cap: cap,
      search_paths_executed: execution,
      candidates: output,
      persistence: 'NONE — live SAM candidate population returned to the active mission only',
    });
  } catch (error) {
    console.error('[ngcc-ops-sam-contractor-discovery]', error);
    return json(200, {
      ok: false,
      stage: 'SAM_CONTRACTOR_DISCOVERY',
      status: 'FAILED',
      error: String(error?.message || 'SAM contractor discovery failed.'),
      search_paths_executed: execution,
    });
  }
};
