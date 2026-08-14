'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const {
  currentRun,
  listCandidates,
  listContactAgents,
  summarizeAgents,
  db,
} = require('./lib/ngcc-contractor-store');
const {
  selectResearchQueue,
  createResearchWorkers,
  researchQueueSummary,
  updateResearchStep,
} = require('./lib/ngcc-contact-research-queue');

const clean = value => String(value ?? '').trim();

async function loadStatus(missionId, searchRunId, attemptNumber) {
  const run = searchRunId ? { id: searchRunId } : await currentRun(missionId);
  if (!run?.id) throw new Error('No current contractor search run exists for this mission.');
  const [candidates, agents, steps] = await Promise.all([
    listCandidates({ searchRunId: run.id }),
    listContactAgents({ searchRunId: run.id, attemptNumber }),
    db('ngcc_procurement_mission_steps', 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&step_code=eq.CONTACT_DISCOVERY&select=*&limit=1`),
  ]);
  const agentSummary = summarizeAgents(agents);
  const selected = candidates.filter(candidate => candidate.operator_selected === true);
  const queueSummary = researchQueueSummary(selected);
  const contacts = selected.filter(candidate => candidate.research_status !== 'NOT_STARTED' || candidate.contact_verified);
  const step = steps?.[0] || null;
  return {
    search_run_id: run.id,
    attempt_number: agents?.[0]?.attempt_number || attemptNumber || null,
    status: step?.status || (agentSummary.all_terminal ? 'COMPLETE' : agents.length ? 'RUNNING' : 'READY'),
    stage_progress_percentage: step?.progress_percentage ?? agentSummary.progress_percentage,
    current_activity: step?.current_activity || null,
    agents,
    agent_summary: agentSummary,
    research_queue_summary: queueSummary,
    candidates,
    contacts,
  };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const missionId = clean(qs.mission_id);
      if (!missionId) return json(400, { ok: false, error: 'mission_id is required.' });
      const state = await loadStatus(missionId, clean(qs.search_run_id), Number(qs.attempt_number || 0) || null);
      return json(200, { ok: true, stage: 'CONTACT_DISCOVERY', ...state });
    }

    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

    const missionId = clean(body.mission_id);
    if (!missionId) return json(400, { ok: false, error: 'mission_id is required for persistent contractor research.' });

    const run = clean(body.search_run_id) ? { id: clean(body.search_run_id) } : await currentRun(missionId);
    if (!run?.id) return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: 'No current contractor search run exists for this mission.' });

    const suppliedIds = Array.isArray(body.candidate_ids) ? body.candidate_ids : [];
    const selected = await selectResearchQueue(run.id, suppliedIds);
    if (!selected.length) {
      return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: 'No persisted Stage 04 SAM contractor candidates are available for research.' });
    }

    const created = await createResearchWorkers({ missionId, searchRunId: run.id, candidates: selected });
    await updateResearchStep(missionId, {
      status: 'RUNNING',
      progress: 0,
      activity: `${created.worker_count} research worker(s) assigned across all ${created.candidate_count} contractor candidate(s). Five is the concurrency limit, not the candidate limit.`,
      summary: {
        search_run_id: run.id,
        attempt_number: created.attempt_number,
        worker_count: created.worker_count,
        candidate_count: created.candidate_count,
        researched_candidates: 0,
        verified_contacts: selected.filter(candidate => candidate.contact_verified).length,
      },
    });

    const state = await loadStatus(missionId, run.id, created.attempt_number);
    return json(200, {
      ok: true,
      stage: 'CONTACT_DISCOVERY',
      status: 'READY_TO_START_BACKGROUND',
      message: 'Persistent contractor-research queue created. Start the authenticated Background Function, then poll this endpoint for worker and queue progress.',
      background_payload: {
        mission_id: missionId,
        search_run_id: run.id,
        attempt_number: created.attempt_number,
        contract_dna: body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null,
        business_search_dna: body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null,
      },
      ...state,
    });
  } catch (error) {
    console.error('[ngcc-ops-contact-discovery]', error);
    return json(200, {
      ok: false,
      stage: 'CONTACT_DISCOVERY',
      status: 'FAILED',
      error: String(error?.message || 'Contractor research launch/status failure.'),
    });
  }
};
