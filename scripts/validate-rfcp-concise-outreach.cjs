'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const outreach = fs.readFileSync('netlify/functions/ngcc-ops-outreach.js', 'utf8');
const commandCenter = fs.readFileSync('ops-command-center-v3.html', 'utf8');

assert.match(outreach, /Apropos Group LLC is a proactive procurement agency\./, 'concise agency opening must be present');
assert.match(outreach, /Our automated system identifies qualified businesses whose services match contract requirements\./, 'automated matching statement must be present');
assert.match(outreach, /We discovered your company while sourcing businesses for this opportunity\./, 'business discovery statement must be present');
assert.match(outreach, /WHY YOUR BUSINESS WAS SELECTED/, 'federal matching explanation must remain present');
assert.match(outreach, /This service is complimentary—no purchase is required\./, 'complimentary service statement must be present');
assert.match(outreach, /You are also welcome to leave a comment or ask a question\./, 'comment invitation must be present');
assert.match(outreach, /Good luck!/, 'approved closing must be present');
assert.match(outreach, /View Contract Opportunity/, 'approved CTA must be present');
assert.match(outreach, /Opportunity Reference:/, 'Marketplace reference workflow must remain present');
assert.match(outreach, /UNSUBSCRIBE/, 'unsubscribe control must remain present');

assert.doesNotMatch(outreach, /Opportunity Builds Business\. Business Builds Community\./, 'legacy opening must be removed');
assert.doesNotMatch(outreach, /Businesses grow\. People prosper\. Communities become stronger\./, 'legacy community closing must be removed');

assert.match(commandCenter, /outreach_approved:false/, 'Portal outreach contacts must default to unselected');
assert.match(commandCenter, /BUSINESS_OUTREACH'&&!approvedContacts\(\)\.length/, 'Stage 07 must require an explicit selection');
assert.match(commandCenter, /original\.outreach_approved=el\.checked;saveEvidence\(\);render\(\)/, 'individual selection must immediately refresh the Stage 07 CTA');
assert.match(commandCenter, /No business is selected automatically/, 'operator guidance must describe the zero-selection default');

console.log('RFCP concise outreach and zero-selection validation passed.');
