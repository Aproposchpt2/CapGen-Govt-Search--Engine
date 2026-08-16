'use strict';

const assert = require('node:assert/strict');
const {
  isPublicEmailCandidate,
  normalizeContactLimit,
  normalizeResearchTimeout,
  knownCapabilityEvidence,
  mergeCapabilityVerifications,
  capabilityEvidenceVerification,
  contactDiscoveryOutcome,
  websiteResearchPrompt,
} = require('../netlify/functions/lib/ngcc-contact-discovery');
const { selectApprovedOutreachContacts, toLegacyOutreachCandidate } = require('../netlify/functions/lib/ngcc-outreach-control');

assert.equal(isPublicEmailCandidate('contracts@example.com'), 'contracts@example.com');
assert.equal(isPublicEmailCandidate('not-an-email'), null);
assert.equal(normalizeContactLimit(999), 5);
assert.equal(normalizeContactLimit(0), 1);
assert.equal(normalizeResearchTimeout(115000), 115000);
assert.equal(normalizeResearchTimeout(999999), 115000);
assert.equal(normalizeResearchTimeout(1000), 5000);

const prompt = websiteResearchPrompt(
  { business_name: 'Ready LLC', city: 'Orlando', state: 'FL', uei: 'UEI1' },
  { title: 'Facilities Support', requirement: { primary_requirement: 'Provide recurring facility support services' } }
);
assert.match(prompt, /OFFICIAL website/);
assert.match(prompt, /PUBLIC email actually published/);
assert.match(prompt, /Never guess, infer, construct, or pattern-generate an email address/);

const evidenceVerification = capabilityEvidenceVerification([
  {
    dimension: 'current_capability_alignment',
    status: 'SUPPORTED',
    reason: 'Official service page describes the required service.',
    url: 'https://ready.example/services',
    title: 'Services',
  },
], { business_name: 'Ready LLC', state: 'FL', uei: 'UEI1' });
assert.equal(evidenceVerification.dimensions.current_capability_alignment.status, 'SUPPORTED');
assert.equal(evidenceVerification.dimensions.current_capability_alignment.sources[0].url, 'https://ready.example/services');

assert.deepEqual(contactDiscoveryOutcome({ VERIFIED: 1, FAILED: 0, NOT_FOUND: 0 }), {
  status: 'SUCCESS',
  retry_required: false,
  message: '1 verified public contact(s) found.',
});
assert.equal(contactDiscoveryOutcome({ VERIFIED: 0, FAILED: 1, NOT_FOUND: 0 }).status, 'RETRY_REQUIRED');
assert.equal(contactDiscoveryOutcome({ VERIFIED: 0, FAILED: 0, NOT_FOUND: 1 }).retry_required, true);

const existingVerification = {
  status: 'PARTIAL',
  verified_at: '2026-08-13T18:00:00.000Z',
  sources: [{ url: 'https://sam.gov/entity/UEI1', title: 'SAM', note: '' }],
  dimensions: {
    current_capability_alignment: { status: 'UNVERIFIED', reason: 'Not yet verified', sources: [] },
    mandatory_requirements: { status: 'UNVERIFIED', reason: '', sources: [] },
    certifications_licenses: { status: 'UNVERIFIED', reason: '', sources: [] },
    past_performance: { status: 'UNVERIFIED', reason: '', sources: [] },
    set_aside_classification: { status: 'UNVERIFIED', reason: '', sources: [] },
    geography_capacity: { status: 'UNVERIFIED', reason: '', sources: [] },
    supplier_role: { status: 'UNVERIFIED', reason: '', sources: [] },
  },
};
const websiteVerification = {
  status: 'PARTIAL',
  verified_at: '2026-08-13T19:00:00.000Z',
  sources: [{ url: 'https://ready.example/services', title: 'Services', note: 'Current service page' }],
  dimensions: {
    current_capability_alignment: {
      status: 'SUPPORTED',
      reason: 'Official service page describes the required service.',
      sources: [{ url: 'https://ready.example/services', title: 'Services', note: '' }],
    },
    mandatory_requirements: { status: 'UNVERIFIED', reason: '', sources: [] },
    certifications_licenses: { status: 'UNVERIFIED', reason: '', sources: [] },
    past_performance: { status: 'UNVERIFIED', reason: '', sources: [] },
    set_aside_classification: { status: 'UNVERIFIED', reason: '', sources: [] },
    geography_capacity: { status: 'UNVERIFIED', reason: '', sources: [] },
    supplier_role: { status: 'UNVERIFIED', reason: '', sources: [] },
  },
};
assert.equal(knownCapabilityEvidence(websiteVerification), true);
const merged = mergeCapabilityVerifications(existingVerification, websiteVerification, { business_name: 'Ready LLC', state: 'FL', uei: 'UEI1' });
assert.equal(merged.dimensions.current_capability_alignment.status, 'SUPPORTED');
assert.ok(merged.dimensions.current_capability_alignment.sources.some(source => source.url === 'https://ready.example/services'));

const contacts = [
  {
    business_name: 'Ready LLC',
    contact_status: 'VERIFIED',
    contact_email: 'contracts@ready.example',
    source_url: 'https://ready.example/contact',
    outreach_approved: true,
    qualification_status: 'QUALIFIED',
    uei: 'UEI1',
  },
  {
    business_name: 'No Approval LLC',
    contact_status: 'VERIFIED',
    contact_email: 'info@noapproval.example',
    source_url: 'https://noapproval.example/contact',
    outreach_approved: false,
    qualification_status: 'QUALIFIED',
  },
  {
    business_name: 'No Source LLC',
    contact_status: 'VERIFIED',
    contact_email: 'info@nosource.example',
    source_url: null,
    outreach_approved: true,
    qualification_status: 'QUALIFIED',
  },
  {
    business_name: 'Disqualified LLC',
    contact_status: 'VERIFIED',
    contact_email: 'info@disqualified.example',
    source_url: 'https://disqualified.example/contact',
    outreach_approved: true,
    qualification_status: 'DISQUALIFIED',
  },
  {
    business_name: 'Insufficient Evidence LLC',
    contact_status: 'VERIFIED',
    contact_email: 'info@insufficient.example',
    source_url: 'https://insufficient.example/contact',
    outreach_approved: true,
    qualification_status: 'INSUFFICIENT_EVIDENCE',
  },
];

const approved = selectApprovedOutreachContacts(contacts);
assert.equal(approved.length, 1);
assert.equal(approved[0].business_name, 'Ready LLC');

const legacy = toLegacyOutreachCandidate(approved[0]);
assert.equal(legacy.contact_email, 'contracts@ready.example');
assert.equal(legacy.ueiSAM, 'UEI1');
assert.equal(legacy.contact_source_url, 'https://ready.example/contact');

console.log('NGCC Stage 06/07 website/contact control tests passed.');
