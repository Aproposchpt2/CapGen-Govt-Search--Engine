'use strict';

const assert = require('node:assert/strict');
const { isPublicEmailCandidate } = require('../netlify/functions/lib/ngcc-contact-discovery');
const { selectApprovedOutreachContacts, toLegacyOutreachCandidate } = require('../netlify/functions/lib/ngcc-outreach-control');

assert.equal(isPublicEmailCandidate('contracts@example.com'), 'contracts@example.com');
assert.equal(isPublicEmailCandidate('not-an-email'), null);

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
];

const approved = selectApprovedOutreachContacts(contacts);
assert.equal(approved.length, 1);
assert.equal(approved[0].business_name, 'Ready LLC');

const legacy = toLegacyOutreachCandidate(approved[0]);
assert.equal(legacy.contact_email, 'contracts@ready.example');
assert.equal(legacy.ueiSAM, 'UEI1');
assert.equal(legacy.contact_source_url, 'https://ready.example/contact');

console.log('NGCC Stage 06/07 control tests passed.');
