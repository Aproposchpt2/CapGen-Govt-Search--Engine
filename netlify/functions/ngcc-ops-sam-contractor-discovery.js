'use strict';

const { json, opsGuard, samEntitySearchByNaics } = require('./lib/ngcc-ops');
const { mergeDiscoveryBatch, finalizeCandidates } = require('./lib/ngcc-contractor-discovery');
const {
  startSearchRun,
  updateSearchRun,
  persistDiscoveryCandidates,
} = require('./lib/ngcc-contractor-store');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const missionId = String(body.mission_id || '').trim();
  const searchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;
  if (!missionId) return json(400, { ok: false, error: 'mission_id is required for durable contractor discovery.' });
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
  let run = null;

  try {
    run = await startSearchRun({
      missionId,
      samNoticeId: searchDna.contract_notice_id,
      businessSearchDna: searchDna,
    });

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
    const examined = execution.reduce((sum, item) => sum + Number(item.returned || 0), 0);
    const persisted = await persistDiscoveryCandidates(run, output);
    await updateSearchRun(run.id, {
      status: output.length ? 'DISCOVERED' : 'ZERO_RESULT',
      search_paths_executed: execution,
      records_examined: examined,
      records_accepted: persisted.length,
      records_rejected: Math.max(0, examined - persisted.length),
      completed_at: new Date().toISOString(),
    });

    return json(200, {
      ok: true,
      stage: 'SAM_CONTRACTOR_DISCOVERY',
      status: persisted.length ? 'SUCCESS' : 'ZERO_RESULT',
      records_examined: examined,
      records_accepted: persisted.length,
      records_rejected: Math.max(0, examined - persisted.length),
      candidate_cap: cap,
      search_run_id: run.id,
      search_run_number: run.run_number,
      search_paths_executed: execution,
      candidates: persisted,
      persistence: 'DURABLE — candidates are stored by mission/search run; new searches preserve prior runs.',
    });
  } catch (error) {
    console.error('[ngcc-ops-sam-contractor-discovery]', error);
    if (run?.id) {
      try {
        await updateSearchRun(run.id, {
          status: 'FAILED',
          search_paths_executed: execution,
          records_examined: execution.reduce((sum, item) => sum + Number(item.returned || 0), 0),
          completed_at: new Date().toISOString(),
        });
      } catch (persistError) {
        console.error('[ngcc-ops-sam-contractor-discovery:persist-failure]', persistError);
      }
    }
    return json(200, {
      ok: false,
      stage: 'SAM_CONTRACTOR_DISCOVERY',
      status: 'FAILED',
      search_run_id: run?.id || null,
      error: String(error?.message || 'SAM contractor discovery failed.'),
      search_paths_executed: execution,
    });
  }
};
