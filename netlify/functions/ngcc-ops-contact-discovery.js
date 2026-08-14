'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const {
  currentRun,
  listCandidates,
  setSelectedCandidates,
  createContactAgents,
  listContactAgents,
  summarizeAgents,
  updateContactStep,
  db,
} = require('./lib/ngcc-contractor-store');

const MAX_SELECTED_CONTACTS = 5;
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
  const contacts = candidates.filter(candidate => candidate.operator_selected || candidate.research_status !== 'NOT_STARTED');
  const step = steps?.[0] || null;
  return {
    search_run_id: run.id,
    attempt_number: agents?.[0]?.attempt_number || attemptNumber || null,
    status: step?.status || (agentSummary.all_terminal ? 'COMPLETE' : agents.length ? 'RUNNING' : 'READY'),
    stage_progress_percentage: step?.progress_percentage ?? agentSummary.progress_percentage,
    current_activity: step?.current_activity || null,
    agents,
    agent_summary: agentSummary,
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
    if (!missionId) return json(400, { ok: false, error: 'mission_id is required for persistent Stage 06 execution.' });

    const run = clean(body.search_run_id) ? { id: clean(body.search_run_id) } : await currentRun(missionId);
    if (!run?.id) return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: 'No current contractor search run exists for this mission.' });

    const supplied = Array.isArray(body.candidate_ids)
      ? body.candidate_ids
      : Array.isArray(body.candidates)
        ? body.candidates.filter(candidate => candidate.operator_selected === true || candidate.operator_disposition === 'APPROVED')
        : [];

    if (!supplied.length) {
      return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: 'Select at least one ranked contractor before Stage 06 website/contact research.' });
    }
    if (supplied.length > MAX_SELECTED_CONTACTS) {
      return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: `Select no more than ${MAX_SELECTED_CONTACTS} contractors for one Stage 06 research run.` });
    }

    const selected = await setSelectedCandidates(run.id, supplied, MAX_SELECTED_CONTACTS);
    if (!selected.length) {
      return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: 'Selected contractor identities did not match persisted Stage 04 candidates.' });
    }

    const created = await createContactAgents({ missionId, searchRunId: run.id, candidates: selected });
    await updateContactStep(missionId, {
      status: 'RUNNING',
      progress: 0,
      activity: `${selected.length} website/contact research agent(s) assigned. Stage 06 remains RUNNING until every assigned agent reaches a terminal 100% state.`,
      summary: {
        search_run_id: run.id,
        attempt_number: created.attempt_number,
        assigned_agents: selected.length,
        completed_agents: 0,
        verified_contacts: 0,
      },
    });

    const state = await loadStatus(missionId, run.id, created.attempt_number);
    return json(200, {
      ok: true,
      stage: 'CONTACT_DISCOVERY',
      status: 'READY_TO_START_BACKGROUND',
      message: 'Persistent Stage 06 assignments created. Start the authenticated Background Function, then poll this endpoint for agent progress.',
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
      error: String(error?.message || 'Stage 06 launch/status failure.'),
    });
  }
};
