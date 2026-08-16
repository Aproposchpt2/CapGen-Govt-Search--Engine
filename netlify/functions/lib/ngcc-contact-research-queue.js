'use strict';

const {
  db,
  nowIso,
  dbRowToCandidate,
} = require('./ngcc-contractor-store');

const CANDIDATES = 'ngcc_contractor_candidates';
const AGENTS = 'ngcc_contact_discovery_agents';
const STEPS = 'ngcc_procurement_mission_steps';
const MISSIONS = 'ngcc_procurement_missions';
const MAX_RESEARCH_WORKERS = 5;
const TERMINAL_SUCCESS = new Set(['SUCCESS', 'ZERO_RESULT', 'COMPLETE']);

const arr = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? '').trim();

function partitionResearchQueue(candidates, workerCount = MAX_RESEARCH_WORKERS) {
  const rows = arr(candidates);
  const count = Math.max(1, Math.min(Number(workerCount || MAX_RESEARCH_WORKERS), MAX_RESEARCH_WORKERS, rows.length || 1));
  const buckets = Array.from({ length: rows.length ? count : 0 }, () => []);
  rows.forEach((candidate, index) => buckets[index % buckets.length].push(candidate));
  return buckets;
}

function researchQueueSummary(candidates) {
  const rows = arr(candidates);
  const completed = rows.filter(candidate => ['SUCCESS', 'NOT_FOUND', 'FAILED'].includes(clean(candidate.research_status).toUpperCase())).length;
  const verified = rows.filter(candidate => candidate.contact_verified === true).length;
  const notFound = rows.filter(candidate => clean(candidate.contact_status).toUpperCase() === 'NOT_FOUND').length;
  const failed = rows.filter(candidate => clean(candidate.research_status).toUpperCase() === 'FAILED').length;
  return {
    total: rows.length,
    completed,
    remaining: Math.max(0, rows.length - completed),
    verified,
    not_found: notFound,
    failed,
  };
}

async function selectResearchQueue(searchRunId, identities = []) {
  const rows = await db(CANDIDATES, 'GET', `?search_run_id=eq.${encodeURIComponent(searchRunId)}&select=*&order=discovery_rank.asc.nullslast,created_at.asc`);
  const wanted = new Set(arr(identities).map(value => clean(typeof value === 'object'
    ? (value.candidate_id || value.ueiSAM || value.uei || value.cageCode || value.cage_code)
    : value)).filter(Boolean));
  const chosen = wanted.size
    ? arr(rows).filter(row => wanted.has(row.candidate_id) || wanted.has(row.uei_sam) || wanted.has(row.cage_code) || wanted.has(row.candidate_key))
    : arr(rows);

  await db(CANDIDATES, 'PATCH', `?search_run_id=eq.${encodeURIComponent(searchRunId)}`, {
    operator_selected: false,
    updated_at: nowIso(),
  }, 'return=minimal');

  if (chosen.length === rows.length && chosen.length) {
    await db(CANDIDATES, 'PATCH', `?search_run_id=eq.${encodeURIComponent(searchRunId)}`, {
      operator_selected: true,
      updated_at: nowIso(),
    }, 'return=minimal');
  } else if (chosen.length) {
    await Promise.all(chosen.map(row => db(CANDIDATES, 'PATCH', `?candidate_id=eq.${encodeURIComponent(row.candidate_id)}`, {
      operator_selected: true,
      updated_at: nowIso(),
    }, 'return=minimal')));
  }

  return chosen.map(dbRowToCandidate);
}

async function nextResearchAttempt(searchRunId) {
  const rows = await db(AGENTS, 'GET', `?search_run_id=eq.${encodeURIComponent(searchRunId)}&select=attempt_number&order=attempt_number.desc&limit=1`);
  return Number(rows?.[0]?.attempt_number || 0) + 1;
}

async function createResearchWorkers({ missionId, searchRunId, candidates }) {
  const selected = arr(candidates);
  if (!selected.length) throw new Error('No persisted SAM contractor candidates are available for research.');

  const attemptNumber = await nextResearchAttempt(searchRunId);
  const buckets = partitionResearchQueue(selected, MAX_RESEARCH_WORKERS);
  const rows = buckets.map((bucket, index) => ({
    mission_id: missionId,
    search_run_id: searchRunId,
    candidate_id: bucket[0].candidate_id,
    attempt_number: attemptNumber,
    agent_slot: index + 1,
    agent_code: `RESEARCH-${String(index + 1).padStart(2, '0')}`,
    status: 'READY',
    progress_percentage: 0,
    current_activity: `Ready to research ${bucket.length} contractor candidate(s); first: ${bucket[0].business_name || bucket[0].businessName}`,
    result_summary: {
      assigned_candidate_ids: bucket.map(candidate => candidate.candidate_id),
      assigned_count: bucket.length,
      completed_count: 0,
      verified_count: 0,
      not_found_count: 0,
      failed_count: 0,
      completed_candidates: [],
    },
  }));
  const created = await db(AGENTS, 'POST', '', rows, 'return=representation');
  return { attempt_number: attemptNumber, agents: created || [], worker_count: rows.length, candidate_count: selected.length };
}

async function updateResearchStep(missionId, { status, progress, activity, summary, errorCode = null, errorMessage = null } = {}) {
  const now = nowIso();
  const steps = await db(STEPS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&select=*&order=sequence_number.asc`);
  const index = arr(steps).findIndex(step => step.step_code === 'CONTACT_DISCOVERY');
  if (index < 0) throw new Error('CONTACT_DISCOVERY mission step was not found.');
  const step = steps[index];
  const requestedStatus = status || step.status;
  const patch = {
    status: requestedStatus,
    progress_percentage: Math.max(0, Math.min(100, Number(progress ?? step.progress_percentage ?? 0))),
    current_activity: activity || step.current_activity,
    last_heartbeat_at: now,
    output_summary: summary || step.output_summary || {},
    error_code: errorCode,
    error_message: errorMessage,
    updated_at: now,
  };
  if (requestedStatus === 'RUNNING') {
    patch.started_at = step.started_at || now;
    patch.completed_at = null;
  }
  if (['SUCCESS', 'ZERO_RESULT', 'FAILED'].includes(requestedStatus)) patch.completed_at = now;
  await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(step.id)}`, patch, 'return=minimal');

  const localSteps = arr(steps).map(item => item.id === step.id ? { ...item, ...patch } : item);
  let next = localSteps[index + 1] || null;
  if (TERMINAL_SUCCESS.has(requestedStatus) && next?.status === 'NOT_STARTED') {
    const nextPatch = {
      status: 'READY',
      progress_percentage: 0,
      current_activity: 'Awaiting operator execution',
      updated_at: now,
    };
    await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(next.id)}`, nextPatch, 'return=minimal');
    next = { ...next, ...nextPatch };
    localSteps[index + 1] = next;
  }

  const completed = localSteps.filter(item => TERMINAL_SUCCESS.has(clean(item.status).toUpperCase())).length;
  const completionPercentage = localSteps.length ? Math.round((completed / localSteps.length) * 100) : 0;
  const failed = requestedStatus === 'FAILED';
  const done = TERMINAL_SUCCESS.has(requestedStatus) && !next;
  const current = TERMINAL_SUCCESS.has(requestedStatus) && next ? next : { ...step, ...patch };

  await db(MISSIONS, 'PATCH', `?id=eq.${encodeURIComponent(missionId)}`, {
    current_step: current?.step_code || 'CONTACT_DISCOVERY',
    overall_status: done ? 'COMPLETE' : failed ? 'FAILED' : 'ACTIVE',
    completion_percentage: completionPercentage,
    next_required_action: done ? 'Mission complete' : current?.step_name || 'Contractor Research & Contact Discovery',
    waiting_condition: null,
    updated_at: now,
    last_activity_at: now,
  }, 'return=minimal');

  return { step: { ...step, ...patch }, next_step: next, completion_percentage: completionPercentage };
}

module.exports = {
  MAX_RESEARCH_WORKERS,
  partitionResearchQueue,
  researchQueueSummary,
  selectResearchQueue,
  nextResearchAttempt,
  createResearchWorkers,
  updateResearchStep,
};
