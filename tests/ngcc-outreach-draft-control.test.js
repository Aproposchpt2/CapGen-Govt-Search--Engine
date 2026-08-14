'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  normalizeOutreachText,
  editableOutreachHtml,
  outreachCopy,
  PRODUCTION_SEND,
} = require('../netlify/functions/ngcc-ops-outreach');

const unsubscribeUrl = 'https://ngcc.aproposgroupllc.com/.netlify/functions/ngcc-unsubscribe?email=client%40example.com&t=secret-token';
const normalized = normalizeOutreachText(`Hello Client\n\nUnsubscribe from future opportunity introductions:\n${unsubscribeUrl}`, unsubscribeUrl);
assert.doesNotMatch(normalized, /secret-token/, 'the editable draft must never expose the tokenized unsubscribe URL');
assert.match(normalized, /UNSUBSCRIBE button at the end of this email/, 'the editable draft must preserve the approved unsubscribe instruction');

const html = editableOutreachHtml(normalized, unsubscribeUrl, 'https://marketplace.aproposgroupllc.com/claim-federal-opportunity?ref=NG-TEST');
assert.match(html, /Claim This Complimentary Opportunity/, 'saved outreach HTML must retain the Marketplace claim CTA');
assert.match(html, />UNSUBSCRIBE</, 'saved outreach HTML must render an unsubscribe button');
assert.match(html, /secret-token/, 'the unsubscribe token belongs only in the HTML action URL, not the editable text');

const copy = outreachCopy({
  noticeId: 'NOTICE-1',
  title: 'Federal Test Opportunity',
  agency: 'Test Agency',
  solicitationNumber: 'SOL-1',
  naicsCode: '541611',
  samUrl: 'https://sam.gov/opp/NOTICE-1/view',
}, {
  business_name: 'Qualified Contractor LLC',
  contact_name: 'Alex',
  contact_email: 'alex@example.com',
}, unsubscribeUrl, 'NG-TEST');
assert.match(copy.subject, /Qualified Contractor LLC/);
assert.match(copy.text, /Opportunity Reference: NG-TEST/);
assert.match(copy.text, /Claim this complimentary opportunity/);
assert.equal(PRODUCTION_SEND, true, 'explicit operator-approved NGCC send must target the real prospective client');

const source = fs.readFileSync(require.resolve('../netlify/functions/ngcc-ops-outreach'), 'utf8');
const controlled = fs.readFileSync(require.resolve('../netlify/functions/ngcc-ops-controlled-outreach'), 'utf8');
assert.match(source, /to: \[outreach\.contact_email\]/, 'production send must resolve the prospective-client recipient from the persisted outreach draft');
assert.match(source, /to: \[OPERATOR_NOTIFICATION_RECIPIENT\]/, 'operator notification must be a separate email');
assert.match(source, /if \(outreach\.status !== 'sent'\)/, 'client send must be idempotent');
assert.match(source, /operator_notification_status: 'SENT'/, 'operator notification result must be persisted');
assert.match(source, /action === 'save'/, 'outreach API must support draft save');
assert.match(source, /action === 'send'/, 'outreach API must require an explicit send action');
assert.match(controlled, /PREPARES drafts only/, 'Stage 07 controlled entrypoint must prepare drafts rather than transmit email');
assert.match(controlled, /action: 'prepare'/, 'controlled Stage 07 must explicitly invoke draft preparation');

console.log('NGCC BusinessContracts-style outreach draft controls passed.');
