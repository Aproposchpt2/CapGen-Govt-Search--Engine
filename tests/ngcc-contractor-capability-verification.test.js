'use strict';

const assert = require('node:assert/strict');
const {
  candidateKey,
  normalizeDimension,
  normalizeVerification,
  contractVerificationProfile,
} = require('../netlify/functions/lib/ngcc-contractor-capability-verification');

const candidate = {
  ueiSAM: 'TESTUEI123',
  businessName: 'Example Contractor LLC',
  state: 'NV',
};

assert.equal(candidateKey(candidate), 'TESTUEI123');

const unsupportedPositive = normalizeDimension({
  status: 'SUPPORTED',
  reason: 'Claimed without a source.',
  sources: [],
});
assert.equal(unsupportedPositive.status, 'UNVERIFIED', 'positive conclusions without a URL must be downgraded');

const sourcedPositive = normalizeDimension({
  status: 'SUPPORTED',
  reason: 'Current official site states this capability.',
  sources: [{ url: 'https://example.com/services', title: 'Services' }],
});
assert.equal(sourcedPositive.status, 'SUPPORTED');
assert.equal(sourcedPositive.sources.length, 1);

const unsupportedMismatch = normalizeDimension({
  status: 'MISMATCH',
  reason: 'No evidence found.',
  sources: [],
});
assert.equal(unsupportedMismatch.status, 'UNVERIFIED', 'absence of evidence must not become a mismatch');

const normalized = normalizeVerification({
  key: 'TESTUEI123',
  status: 'VERIFIED',
  sources: [{ url: 'https://example.com/services', title: 'Services' }],
  dimensions: {
    current_capability_alignment: {
      status: 'SUPPORTED',
      reason: 'Current services align.',
      sources: [{ url: 'https://example.com/services' }],
    },
    past_performance: {
      status: 'SUPPORTED',
      reason: 'No source supplied.',
      sources: [],
    },
  },
}, candidate);
assert.equal(normalized.dimensions.current_capability_alignment.status, 'SUPPORTED');
assert.equal(normalized.dimensions.past_performance.status, 'UNVERIFIED');
assert.equal(normalized.status, 'PARTIAL');

const profile = contractVerificationProfile({
  title: 'Aerobics Instructor Services',
  requirement: {
    primary_requirement: 'Provide certified aerobics instructors.',
    required_certifications: ['Certified instructor'],
  },
  hard_constraints: { mandatory_requirements: ['Provide recurring classes'] },
});
assert.equal(profile.title, 'Aerobics Instructor Services');
assert.equal(profile.required_certifications.length, 1);
assert.equal(profile.mandatory_requirements.length, 1);

console.log('NGCC contractor capability verification tests passed.');
