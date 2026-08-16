'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { outreachCopy } = require('../netlify/functions/ngcc-ops-outreach');

const unsubscribeUrl = 'https://ngcc.aproposgroupllc.com/.netlify/functions/ngcc-unsubscribe?email=test%40example.com&t=test-token';
const copy = outreachCopy({
  noticeId: 'NOTICE-TEST',
  title: 'Federal Test Opportunity',
  agency: 'Test Agency',
  solicitationNumber: 'SOL-TEST',
  naicsCode: '541611',
  samUrl: 'https://sam.gov/opp/NOTICE-TEST/view',
}, {
  business_name: 'Qualified Contractor LLC',
  contact_email: 'test@example.com',
}, unsubscribeUrl, 'NG-ABC12345');

assert.equal(copy.claimLink, 'https://marketplace.aproposgroupllc.com/');
assert.match(copy.text, /Claim Your Complimentary Contract Opportunity/);
assert.match(copy.text, /1\. Visit:\s+marketplace\.aproposgroupllc\.com/);
assert.match(copy.text, /2\. Select:\s+CLAIM YOUR COMPLIMENTARY CONTRACT OPPORTUNITY/);
assert.match(copy.text, /3\. Enter your Opportunity Reference:\s+NG-ABC12345/);
assert.doesNotMatch(copy.text, /claim-federal-opportunity/i);
assert.match(copy.html, /VISIT APROPOS MARKETPLACE/);
assert.doesNotMatch(copy.html, /claim-federal-opportunity/i);

const claimSource = fs.readFileSync(require.resolve('../netlify/functions/ngcc-federal-claim'), 'utf8');
assert.match(claimSource, /REFERENCE_ONLY_FEDERAL_CLAIM/);
assert.match(claimSource, /contact_email=eq\.\$\{encodeURIComponent\(email\)\}&status=eq\.sent/);
assert.match(claimSource, /claimReference\(rowNoticeId, email\) === reference/);
assert.match(claimSource, /normalize\(businessName\) === normalize\(row\.business_name\)/);

console.log('NGCC Marketplace front-door claim routing passed.');
