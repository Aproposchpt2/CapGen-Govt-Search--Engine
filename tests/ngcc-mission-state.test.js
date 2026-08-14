'use strict';

const assert = require('node:assert/strict');
const {
  MISSION_STEPS,
  initialStepRows,
  assertSequentialTransition,
  nextStepCode,
  deriveStatus,
  missionProjection,
} = require('../netlify/functions/lib/ngcc-mission-state');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

function freshSteps() {
  return initialStepRows('mission-1', { noticeId: 'SAM-001', title: 'Test Contract' }, '2026-08-11T16:00:00.000Z')
    .map((step, index) => ({ ...step, id: `step-${index + 1}` }));
}

test('canonical mission stages route research before qualification', () => {
  assert.deepEqual(MISSION_STEPS.map(([code]) => code), [
    'OPPORTUNITY_DISCOVERY',
    'CONTRACT_DNA',
    'BUSINESS_SEARCH_DNA',
    'SAM_CONTRACTOR_DISCOVERY',
    'CONTACT_DISCOVERY',
    'CONTRACTOR_QUALIFICATION',
    'BUSINESS_OUTREACH',
    'RESPONSE_CONTRACT_ASSISTANCE',
  ]);
});

test('fresh mission unlocks only Contract DNA', () => {
  const steps = freshSteps();
  assert.equal(steps[0].status, 'SUCCESS');
  assert.equal(steps[1].status, 'READY');
  assert.ok(steps.slice(2).every(step => step.status === 'NOT_STARTED'));
});

test('downstream stage cannot run before prior stage succeeds', () => {
  const steps = freshSteps();
  assert.throws(
    () => assertSequentialTransition(steps, 'BUSINESS_SEARCH_DNA', 'RUNNING'),
    /locked until CONTRACT_DNA completes successfully/
  );
});

test('ready stage may enter RUNNING', () => {
  const steps = freshSteps();
  const result = assertSequentialTransition(steps, 'CONTRACT_DNA', 'RUNNING');
  assert.equal(result.status, 'RUNNING');
});

test('stage cannot report success without execution', () => {
  const steps = freshSteps();
  assert.throws(
    () => assertSequentialTransition(steps, 'CONTRACT_DNA', 'SUCCESS'),
    /cannot complete from READY/
  );
});

test('successful Contract DNA points to Business Search DNA', () => {
  assert.equal(nextStepCode('CONTRACT_DNA'), 'BUSINESS_SEARCH_DNA');
});

test('successful SAM discovery points to contractor research', () => {
  assert.equal(nextStepCode('SAM_CONTRACTOR_DISCOVERY'), 'CONTACT_DISCOVERY');
});

test('successful contractor research points to qualification', () => {
  assert.equal(nextStepCode('CONTACT_DISCOVERY'), 'CONTRACTOR_QUALIFICATION');
});

test('successful qualification points to business outreach', () => {
  assert.equal(nextStepCode('CONTRACTOR_QUALIFICATION'), 'BUSINESS_OUTREACH');
});

test('successful outreach points to response and contract assistance', () => {
  assert.equal(nextStepCode('BUSINESS_OUTREACH'), 'RESPONSE_CONTRACT_ASSISTANCE');
});

test('stale RUNNING heartbeat derives STALLED without rewriting stored state', () => {
  const step = {
    status: 'RUNNING',
    last_heartbeat_at: '2026-08-11T16:00:00.000Z',
  };
  const derived = deriveStatus(step, 180, new Date('2026-08-11T16:04:00.000Z').getTime());
  assert.equal(derived, 'STALLED');
  assert.equal(step.status, 'RUNNING');
});

test('mission projection selects the only actionable stage', () => {
  const steps = freshSteps();
  const projection = missionProjection(steps);
  assert.equal(projection.current_step, 'CONTRACT_DNA');
  assert.equal(projection.overall_status, 'ACTIVE');
  assert.equal(projection.next_required_action, 'Construct Contract DNA');
});

console.log('NGCC mission-state validation passed.');
