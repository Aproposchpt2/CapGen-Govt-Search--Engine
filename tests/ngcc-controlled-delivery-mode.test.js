'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../netlify/functions/ngcc-ops-outreach'), 'utf8');
const outreach = require('../netlify/functions/ngcc-ops-outreach');

assert.equal(outreach.PRODUCTION_SEND, false, 'NGCC outreach must default to controlled test delivery before VAR cutover');
assert.match(source, /NGCC_OUTREACH_DELIVERY_MODE \|\| 'test'/, 'production delivery must require an explicit environment switch');
assert.match(source, /PRODUCTION_SEND \? outreach\.contact_email : TEST_RECIPIENT/, 'test mode must deliver to the configured test recipient');
assert.match(source, /to: \[deliveryRecipient\]/, 'Resend client delivery must use the controlled delivery recipient');
assert.match(source, /intended_recipient: outreach\.contact_email/, 'the real contractor email must remain persisted as the intended recipient');
assert.match(source, /delivery_mode: PRODUCTION_SEND \? 'production' : 'controlled_test'/, 'delivery mode must be persisted for audit evidence');

console.log('NGCC controlled test delivery mode passed.');
