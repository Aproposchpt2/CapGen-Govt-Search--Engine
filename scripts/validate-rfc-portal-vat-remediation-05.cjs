'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const onboarding = read('onboarding.html');
const pipelineSend = read('netlify/functions/pipeline-otp-send.js');
const pipelineVerify = read('netlify/functions/pipeline-otp-verify.js');
const authoritativeSend = read('netlify/functions/send-member-login-code.js');
const authoritativeVerify = read('netlify/functions/verify-member-login-code.js');

assert.match(onboarding, /Registered Federal Contractors Portal/, 'login page must use merged portal branding');
assert.match(onboarding, /Federal \+ State Contract Dashboard/, 'login page must identify the merged dashboard');
assert.match(onboarding, /expires in 10 minutes/, 'login page OTP lifetime must match the backend');
assert.match(onboarding, /autocomplete="one-time-code"/, 'OTP input must support platform one-time-code autofill');
assert.match(onboarding, /pipeline-otp-send/, 'customer login must use the compatibility send route');
assert.match(onboarding, /pipeline-otp-verify/, 'customer login must use the compatibility verify route');
assert.match(onboarding, /window\.location\.assign\('\/dashboard\.html'\)/, 'verified login must open the canonical dashboard directly');
assert.doesNotMatch(onboarding, /No access record found for that email/, 'login UI must not disclose account existence');
assert.doesNotMatch(onboarding, /do not paste/i, 'login UI must not falsely prohibit paste');

assert.match(pipelineSend, /require\('\.\/send-member-login-code\.js'\)/, 'active send route must delegate to the authoritative merged identity handler');
assert.doesNotMatch(pipelineSend, /capgen_subscriptions/, 'active send route must not gate access on legacy CapGen subscriptions');
assert.doesNotMatch(pipelineSend, /Math\.random/, 'active send route must not generate non-cryptographic OTPs');
assert.doesNotMatch(pipelineSend, /No account found/, 'active send route must not disclose account existence');

assert.match(pipelineVerify, /require\('\.\/verify-member-login-code\.js'\)/, 'active verify route must delegate to the authoritative merged identity handler');
assert.doesNotMatch(pipelineVerify, /accountType\s*=\s*'subscriber'/, 'active verify route must not manufacture subscriber entitlement');
assert.doesNotMatch(pipelineVerify, /capgen_subscriptions/, 'active verify route must not reconstruct authorization from legacy subscriptions');
assert.match(pipelineVerify, /session_token: sessionToken/, 'active verify route must preserve the dashboard response contract');

assert.match(authoritativeSend, /crypto\.randomInt\(100000, 1000000\)/, 'authoritative OTP generation must remain cryptographic');
assert.match(authoritativeSend, /invalidateOutstandingCodes\(email\)/, 'new OTP issuance must invalidate prior outstanding codes');
assert.match(authoritativeSend, /GENERIC_ACCEPTED/, 'authoritative send endpoint must use a generic outward response');
assert.doesNotMatch(authoritativeSend, /found:\s*(true|false)/, 'authoritative send endpoint must not expose account-existence booleans');
assert.match(authoritativeVerify, /account_type: identity\.account_type/, 'authoritative verifier must preserve resolved identity rather than inventing entitlement');
assert.match(authoritativeVerify, /revoked: false/, 'verified sessions must be explicitly non-revoked at creation');

console.log('RFC Portal VAT Remediation 05 active returning-member path validation passed.');
