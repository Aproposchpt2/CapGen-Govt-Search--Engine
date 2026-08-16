'use strict';

const assert = require('node:assert/strict');
const {
  agentTerminal,
  summarizeAgents,
  candidateKey,
} = require('../netlify/functions/lib/ngcc-contractor-store');

function agent(slot, status, progress) {
  return {
    agent_slot: slot,
    status,
    progress_percentage: progress,
  };
}

{
  const summary = summarizeAgents([
    agent(1, 'SUCCESS', 100),
    agent(2, 'SUCCESS', 100),
    agent(3, 'NOT_FOUND', 100),
    agent(4, 'SUCCESS', 100),
    agent(5, 'RUNNING', 80),
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.completed, 4);
  assert.equal(summary.progress_percentage, 96);
  assert.equal(summary.all_terminal, false, 'Stage 06 must remain incomplete while any assigned agent is below a terminal 100% state.');
}

{
  const summary = summarizeAgents([
    agent(1, 'SUCCESS', 100),
    agent(2, 'SUCCESS', 100),
    agent(3, 'NOT_FOUND', 100),
    agent(4, 'SUCCESS', 100),
    agent(5, 'FAILED', 100),
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.completed, 5);
  assert.equal(summary.progress_percentage, 100);
  assert.equal(summary.all_terminal, true, 'All five assigned agents must be terminal before Stage 06 execution is complete.');
  assert.equal(summary.success, 3);
  assert.equal(summary.not_found, 1);
  assert.equal(summary.failed, 1);
}

{
  const summary = summarizeAgents([]);
  assert.equal(summary.all_terminal, false, 'An empty assignment set must never be treated as a completed Stage 06 run.');
}

assert.equal(agentTerminal(agent(1, 'NOT_FOUND', 100)), true);
assert.equal(agentTerminal(agent(1, 'FAILED', 100)), true);
assert.equal(agentTerminal(agent(1, 'RUNNING', 100)), false, 'RUNNING is not terminal even when a progress value is accidentally 100.');

assert.equal(candidateKey({ ueiSAM: 'ABC123' }), candidateKey({ ueiSAM: 'ABC123', businessName: 'Different display name' }));
assert.notEqual(candidateKey({ businessName: 'Alpha', state: 'CA' }), candidateKey({ businessName: 'Alpha', state: 'NV' }));

console.log('NGCC persistent five-agent Stage 06 state tests passed.');
