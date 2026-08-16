'use strict';

const assert = require('node:assert/strict');
const {
  MAX_RESEARCH_WORKERS,
  partitionResearchQueue,
  researchQueueSummary,
} = require('../netlify/functions/lib/ngcc-contact-research-queue');

const candidates = Array.from({ length: 20 }, (_, index) => ({
  candidate_id: `candidate-${index + 1}`,
  business_name: `Business ${index + 1}`,
  research_status: 'NOT_STARTED',
  contact_verified: false,
}));

const buckets = partitionResearchQueue(candidates);
assert.equal(MAX_RESEARCH_WORKERS, 5);
assert.equal(buckets.length, 5, 'Twenty contractors must be handled by five concurrent workers, not twenty workers.');
assert.deepEqual(buckets.map(bucket => bucket.length), [4, 4, 4, 4, 4]);
assert.equal(new Set(buckets.flat().map(candidate => candidate.candidate_id)).size, 20, 'Every contractor must appear exactly once in the research queue.');

const uneven = partitionResearchQueue(candidates.slice(0, 12));
assert.deepEqual(uneven.map(bucket => bucket.length), [3, 3, 2, 2, 2]);
assert.equal(new Set(uneven.flat().map(candidate => candidate.candidate_id)).size, 12);

const summary = researchQueueSummary([
  { research_status: 'SUCCESS', contact_verified: true, contact_status: 'VERIFIED' },
  { research_status: 'NOT_FOUND', contact_verified: false, contact_status: 'NOT_FOUND' },
  { research_status: 'FAILED', contact_verified: false, contact_status: 'FAILED' },
  { research_status: 'NOT_STARTED', contact_verified: false, contact_status: 'NOT_RESEARCHED' },
]);
assert.deepEqual(summary, {
  total: 4,
  completed: 3,
  remaining: 1,
  verified: 1,
  not_found: 1,
  failed: 1,
});

console.log('NGCC full-queue five-worker routing tests passed.');
