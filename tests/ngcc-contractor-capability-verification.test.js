'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_VERIFICATION_LIMIT,
  MAX_VERIFICATION_LIMIT,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  normalizeVerificationLimit,
  normalizeVerificationTimeout,
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

assert.equal(DEFAULT_VERIFICATION_LIMIT, 5, 'live Stage 05 research should default to a bounded top-five pass');
assert.equal(MAX_VERIFICATION_LIMIT, 8, 'operator-requested live verification must remain bounded');
assert.equal(normalizeVerificationLimit(undefined), 5);
assert.equal(normalizeVerificationLimit(20), 8, 'requested verification count must be capped');
assert.equal(normalizeVerificationLimit(0), 1, 'a live verification pass must have at least one target');
assert.equal(DEFAULT_VERIFICATION_TIMEOUT_MS, 35000, 'public-web verification must finish before the synchronous proxy inactivity ceiling');
assert.equal(normalizeVerificationTimeout(999999), 35000, 'timeout must not exceed the controlled Stage 05 timebox');
assert.equal(normalizeVerificationTimeout(100), 5000, 'timeout must retain a practical minimum');

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