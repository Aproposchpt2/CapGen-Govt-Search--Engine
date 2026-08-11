'use strict';

const { json, opsGuard, SUPABASE_URL, SUPABASE_KEY, sbHeaders } = require('./lib/ngcc-ops');
const {
  MISSION_STEPS,
  initialStepRows,
  assertSequentialTransition,
  nextStepCode,
  deriveStatus,
  missionProjection,
} = require('./lib/ngcc-mission-state');

const MISSIONS = 'ngcc_procurement_missions';
const STEPS = 'ngcc_procurement_mission_steps';
const EVENTS = 'ngcc_procurement_mission_events';
const nowIso = () => new Date().toISOString();

function ensureDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('NGCC operational database configuration is incomplete.');
}

async function db(table, method = 'GET', query = '', body, prefer = '') {
  ensureDb();
  const response = await fetch(`${String(SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/${table}${query || ''}`, {
    method,
    headers: { ...sbHeaders(), ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${table} ${method} failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function missionNumber() {
  const d = new Date();
  const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `NGCC-FP-${date}-${suffix}`;
}

async function loadMission(missionId) {
  const missionRows = await db(MISSIONS, 'GET', `?id=eq.${encodeURIComponent(missionId)}&select=*&limit=1`);
  const mission = missionRows[0];
  if (!mission) throw new Error('NGCC procurement mission was not found.');
  const steps = await db(STEPS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&select=*&order=sequence_number.asc`);
  const events = await db(EVENTS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&select=*&order=created_at.desc&limit=50`);
  const staleSeconds = Math.max(30, Number(process.env.NGCC_MISSION_STALE_SECONDS || 180));
  return {
    mission,
    steps: steps.map(step => ({ ...step, derived_status: deriveStatus(step, staleSeconds) })),
    events,
  };
}

async function createMission(opportunity) {
  const noticeId = String(opportunity.noticeId || opportunity.notice_id || '').trim();
  const title = String(opportunity.title || '').trim();
  if (!noticeId || !title) throw new Error('A SAM notice ID and contract title are required to create a mission.');
  const now = nowIso();
  const created = await db(MISSIONS, 'POST', '', [{
    mission_number: missionNumber(),
    sam_notice_id: noticeId,
    solicitation_number: opportunity.solicitationNumber || opportunity.solicitation_number || null,
    contract_title: title,
    issuing_agency: opportunity.agency || opportunity.organizationName || null,
    source_url: opportunity.samUrl || opportunity.sam_url || null,
    current_step: 'CONTRACT_DNA',
    overall_status: 'ACTIVE',
    completion_percentage: 13,
    next_required_action: 'Construct Contract DNA',
    selected_opportunity_snapshot: opportunity,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  }], 'return=representation');
  const mission = created[0];
  if (!mission) throw new Error('Mission creation did not return a record.');

  await db(STEPS, 'POST', '', initialStepRows(mission.id, opportunity, now), 'return=minimal');
  await db(EVENTS, 'POST', '', [{
    mission_id: mission.id,
    event_type: 'MISSION_CREATED',
    event_summary: 'Fresh federal procurement mission created. Contract DNA is ready; downstream stages remain locked.',
    event_payload: { sam_notice_id: noticeId, workflow_version: 'ngcc-proactive-procurement-v1', fresh_execution: true },
    actor_type: 'OPERATOR',
  }], 'return=minimal');
  return loadMission(mission.id);
}

async function transitionMission(body) {
  const missionId = String(body.mission_id || '').trim();
  const stepCode = String(body.step_code || '').trim().toUpperCase();
  const requestedStatus = String(body.status || '').trim().toUpperCase();
  if (!missionId || !stepCode || !requestedStatus) throw new Error('mission_id, step_code, and status are required.');

  const loaded = await loadMission(missionId);
  const check = assertSequentialTransition(loaded.steps, stepCode, requestedStatus);
  const now = nowIso();
  const patch = {
    status: check.status,
    progress_percentage: Math.max(0, Math.min(100, Number(body.progress_percentage ?? (check.status === 'RUNNING' ? Math.max(1, check.step.progress_percentage || 0) : check.status === 'SUCCESS' || check.status === 'ZERO_RESULT' || check.status === 'COMPLETE' ? 100 : check.step.progress_percentage || 0)))),
    current_activity: body.current_activity || null,
    output_summary: body.output_summary && typeof body.output_summary === 'object' ? body.output_summary : check.step.output_summary || {},
    evidence: Array.isArray(body.evidence) ? body.evidence : check.step.evidence || [],
    records_examined: Math.max(0, Number(body.records_examined ?? check.step.records_examined ?? 0)),
    records_accepted: Math.max(0, Number(body.records_accepted ?? check.step.records_accepted ?? 0)),
    records_rejected: Math.max(0, Number(body.records_rejected ?? check.step.records_rejected ?? 0)),
    error_code: body.error_code || null,
    error_message: body.error_message || null,
    updated_at: now,
  };
  if (check.status === 'RUNNING') {
    patch.started_at = check.step.started_at || now;
    patch.last_heartbeat_at = now;
    patch.completed_at = null;
  }
  if (['SUCCESS', 'ZERO_RESULT', 'COMPLETE'].includes(check.status)) {
    patch.started_at = check.step.started_at || now;
    patch.last_heartbeat_at = now;
    patch.completed_at = now;
    patch.error_code = null;
    patch.error_message = null;
  }
  if (check.status === 'FAILED') {
    patch.started_at = check.step.started_at || now;
    patch.last_heartbeat_at = now;
    patch.completed_at = now;
    patch.retry_count = Number(check.step.retry_count || 0) + 1;
  }

  await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(check.step.id)}`, patch, 'return=minimal');

  const nextCode = nextStepCode(stepCode);
  if (['SUCCESS', 'ZERO_RESULT', 'COMPLETE'].includes(check.status) && nextCode) {
    const next = loaded.steps.find(step => step.step_code === nextCode);
    if (next && next.status === 'NOT_STARTED') {
      await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(next.id)}`, {
        status: 'READY', progress_percentage: 0, current_activity: 'Awaiting operator execution', updated_at: now,
      }, 'return=minimal');
    }
  }

  const afterSteps = await db(STEPS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&select=*&order=sequence_number.asc`);
  const projection = missionProjection(afterSteps);
  await db(MISSIONS, 'PATCH', `?id=eq.${encodeURIComponent(missionId)}`, {
    ...projection,
    waiting_condition: check.status === 'WAITING' ? body.waiting_condition || body.current_activity || 'Operator review required' : null,
    updated_at: now,
    last_activity_at: now,
  }, 'return=minimal');
  await db(EVENTS, 'POST', '', [{
    mission_id: missionId,
    event_type: 'STEP_TRANSITION',
    event_summary: `${stepCode} -> ${check.status}`,
    event_payload: { step_code: stepCode, status: check.status, progress_percentage: patch.progress_percentage, next_step: nextCode },
    actor_type: body.actor_type || 'SYSTEM',
  }], 'return=minimal');
  return loadMission(missionId);
}

async function heartbeat(body) {
  const missionId = String(body.mission_id || '').trim();
  const stepCode = String(body.step_code || '').trim().toUpperCase();
  const loaded = await loadMission(missionId);
  const step = loaded.steps.find(item => item.step_code === stepCode);
  if (!step) throw new Error('Mission step was not found.');
  if (step.status !== 'RUNNING') throw new Error('Heartbeat is accepted only for a RUNNING step.');
  const now = nowIso();
  await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(step.id)}`, {
    last_heartbeat_at: now,
    progress_percentage: Math.max(Number(step.progress_percentage || 0), Math.min(99, Number(body.progress_percentage ?? step.progress_percentage ?? 0))),
    current_activity: body.current_activity || step.current_activity,
    records_examined: Math.max(0, Number(body.records_examined ?? step.records_examined ?? 0)),
    records_accepted: Math.max(0, Number(body.records_accepted ?? step.records_accepted ?? 0)),
    records_rejected: Math.max(0, Number(body.records_rejected ?? step.records_rejected ?? 0)),
    updated_at: now,
  }, 'return=minimal');
  await db(MISSIONS, 'PATCH', `?id=eq.${encodeURIComponent(missionId)}`, { last_activity_at: now, updated_at: now }, 'return=minimal');
  return loadMission(missionId);
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (qs.mission_id) return json(200, { ok: true, ...(await loadMission(qs.mission_id)) });
      const missions = await db(MISSIONS, 'GET', '?select=*&order=last_activity_at.desc&limit=50');
      return json(200, { ok: true, missions });
    }
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });
    const body = JSON.parse(event.body || '{}');
    const action = String(body.action || '').trim().toLowerCase();
    if (action === 'create') return json(201, { ok: true, ...(await createMission(body.opportunity || {})) });
    if (action === 'transition') return json(200, { ok: true, ...(await transitionMission(body)) });
    if (action === 'heartbeat') return json(200, { ok: true, ...(await heartbeat(body)) });
    return json(400, { ok: false, error: 'Unknown mission-control action.' });
  } catch (error) {
    console.error('[ngcc-ops-mission-control]', error);
    const status = /locked|cannot|requires action|not search-ready/i.test(error.message) ? 409 : /required|Invalid JSON|not found/i.test(error.message) ? 400 : 500;
    return json(status, { ok: false, error: error.message });
  }
};
