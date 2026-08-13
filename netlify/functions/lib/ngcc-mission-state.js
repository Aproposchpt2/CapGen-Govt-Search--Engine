'use strict';

const MISSION_STEPS = Object.freeze([
  ['OPPORTUNITY_DISCOVERY', 'Opportunity Discovery'],
  ['CONTRACT_DNA', 'Construct Contract DNA'],
  ['BUSINESS_SEARCH_DNA', 'Construct Business Search DNA'],
  ['SAM_CONTRACTOR_DISCOVERY', 'SAM Contractor Discovery'],
  ['CONTRACTOR_QUALIFICATION', 'Contractor Qualification'],
  ['CONTACT_DISCOVERY', 'Website & Contact Discovery'],
  ['BUSINESS_OUTREACH', 'Business Outreach'],
  ['RESPONSE_CONTRACT_ASSISTANCE', 'Response / Contract Assistance'],
]);

const TERMINAL_SUCCESS = new Set(['SUCCESS', 'ZERO_RESULT', 'COMPLETE']);
const TERMINAL_FAILURE = new Set(['FAILED', 'CANCELED']);
const ALLOWED_STATUS = new Set(['NOT_STARTED', 'READY', 'RUNNING', 'WAITING', 'SUCCESS', 'ZERO_RESULT', 'FAILED', 'STALLED', 'CANCELED', 'COMPLETE']);

function normalizeStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!ALLOWED_STATUS.has(status)) throw new Error(`Unsupported mission step status: ${status || '(empty)'}`);
  return status;
}

function initialStepRows(missionId, opportunity = {}, now = new Date().toISOString()) {
  return MISSION_STEPS.map(([stepCode, stepName], index) => ({
    mission_id: missionId,
    step_code: stepCode,
    step_name: stepName,
    sequence_number: index + 1,
    status: index === 0 ? 'SUCCESS' : index === 1 ? 'READY' : 'NOT_STARTED',
    progress_percentage: index === 0 ? 100 : 0,
    current_activity: index === 0 ? 'Federal opportunity selected from SAM.gov' : index === 1 ? 'Awaiting operator execution' : null,
    started_at: index === 0 ? now : null,
    last_heartbeat_at: index === 0 ? now : null,
    completed_at: index === 0 ? now : null,
    output_summary: index === 0 ? {
      sam_notice_id: opportunity.noticeId || opportunity.notice_id || null,
      solicitation_number: opportunity.solicitationNumber || opportunity.solicitation_number || null,
      title: opportunity.title || null,
      source: 'SAM.gov',
    } : {},
    evidence: index === 0 ? [{ type: 'SAM_OPPORTUNITY_SELECTION', source: 'SAM.gov' }] : [],
  }));
}

function findStepIndex(stepCode) {
  return MISSION_STEPS.findIndex(([code]) => code === stepCode);
}

function assertSequentialTransition(steps, stepCode, requestedStatus) {
  const status = normalizeStatus(requestedStatus);
  const ordered = [...steps].sort((a, b) => Number(a.sequence_number) - Number(b.sequence_number));
  const index = ordered.findIndex(step => step.step_code === stepCode);
  if (index < 0) throw new Error(`Unknown mission step: ${stepCode}`);
  const step = ordered[index];
  const current = normalizeStatus(step.status);

  if (index > 0) {
    const prior = ordered[index - 1];
    if (!TERMINAL_SUCCESS.has(normalizeStatus(prior.status))) {
      throw new Error(`${stepCode} is locked until ${prior.step_code} completes successfully.`);
    }
  }

  const activeEarlier = ordered.slice(0, index).find(item => ['READY', 'RUNNING', 'WAITING', 'FAILED', 'STALLED'].includes(normalizeStatus(item.status)));
  if (activeEarlier) throw new Error(`${stepCode} cannot advance while ${activeEarlier.step_code} still requires action.`);

  if (status === 'RUNNING' && !['READY', 'WAITING', 'FAILED', 'STALLED', 'RUNNING'].includes(current)) {
    throw new Error(`${stepCode} cannot enter RUNNING from ${current}.`);
  }
  if (['SUCCESS', 'ZERO_RESULT', 'COMPLETE'].includes(status) && !['RUNNING', 'WAITING'].includes(current)) {
    throw new Error(`${stepCode} cannot complete from ${current}.`);
  }
  if (status === 'READY' && current !== 'NOT_STARTED') {
    throw new Error(`${stepCode} cannot enter READY from ${current}.`);
  }
  return { ordered, index, step, current, status };
}

function nextStepCode(stepCode) {
  const index = findStepIndex(stepCode);
  return index >= 0 && index < MISSION_STEPS.length - 1 ? MISSION_STEPS[index + 1][0] : null;
}

function completionFromSteps(steps) {
  if (!steps.length) return 0;
  const completed = steps.filter(step => TERMINAL_SUCCESS.has(normalizeStatus(step.status))).length;
  return Math.round((completed / steps.length) * 100);
}

function deriveStatus(step, staleSeconds = 180, now = Date.now()) {
  const status = normalizeStatus(step.status);
  if (status !== 'RUNNING') return status;
  const heartbeat = step.last_heartbeat_at ? new Date(step.last_heartbeat_at).getTime() : 0;
  if (!heartbeat) return status;
  return now - heartbeat > staleSeconds * 1000 ? 'STALLED' : status;
}

function missionProjection(steps) {
  const ordered = [...steps].sort((a, b) => Number(a.sequence_number) - Number(b.sequence_number));
  const actionable = ordered.find(step => ['FAILED', 'STALLED', 'RUNNING', 'WAITING', 'READY'].includes(normalizeStatus(step.status))) || null;
  const done = ordered.every(step => TERMINAL_SUCCESS.has(normalizeStatus(step.status)));
  return {
    current_step: done ? MISSION_STEPS[MISSION_STEPS.length - 1][0] : actionable?.step_code || null,
    overall_status: done ? 'COMPLETE' : actionable && TERMINAL_FAILURE.has(normalizeStatus(actionable.status)) ? 'FAILED' : actionable?.status === 'WAITING' ? 'WAITING' : 'ACTIVE',
    completion_percentage: completionFromSteps(ordered),
    next_required_action: done ? 'Mission complete' : actionable ? actionable.step_name : 'Review mission state',
  };
}

module.exports = {
  MISSION_STEPS,
  TERMINAL_SUCCESS,
  ALLOWED_STATUS,
  normalizeStatus,
  initialStepRows,
  assertSequentialTransition,
  nextStepCode,
  completionFromSteps,
  deriveStatus,
  missionProjection,
};
