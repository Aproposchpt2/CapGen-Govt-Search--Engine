'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const onboarding = read('onboarding.html');
const pipelineSend = read('netlify/functions/pipeline-otp-send.js');
const pipelineVerify = read('netlify/functions/pipeline-otp-verify.js');
const send = read('netlify/functions/send-member-login-code.js');
const verify = read('netlify/functions/verify-member-login-code.js');

for (const [name, source] of [['send', send], ['verify', verify]]) {
  assert.match(source, /natcorp_business_intakes/, `${name} must recognize the merged verified business profile`);
  assert.match(source, /intake_kind=eq\.business_profile/, `${name} must restrict shared-profile lookup to business profiles`);
  assert.match(source, /discovery_status=eq\.verified/, `${name} must require a verified shared profile`);
  assert.match(source, /biz_center_members/, `${name} must retain legacy Business Center compatibility`);
  assert.match(source, /capgen_customers/, `${name} must retain legacy direct-customer compatibility`);
  assert.ok(source.indexOf('findVerifiedProfile') < source.indexOf('findActivatedMember'), `${name} must define merged-profile resolution before legacy member resolution`);
  assert.match(source, /account_type: 'portal_profile'/, `${name} must classify verified-profile-only recovery as entitlement-neutral portal_profile`);
}

assert.match(send, /crypto\.randomInt\(100000, 1000000\)/, 'OTP generation must use cryptographic randomness');
assert.match(send, /invalidateOutstandingCodes\(email\)/, 'new OTP issuance must invalidate prior outstanding codes');
assert.match(send, /GENERIC_ACCEPTED/, 'returning-member send must use a generic outward response');
assert.doesNotMatch(send, /found:\s*(true|false)/, 'returning-member send must not expose account-existence booleans');
assert.match(send, /Registered Federal Contractors Portal/, 'returning-member email must use merged portal branding');
assert.match(send, /Federal \+ State Contract Dashboard/, 'returning-member email must describe the merged dashboard');
assert.doesNotMatch(send, /access your Federal CapGen dashboard/, 'legacy Federal CapGen customer wording must not survive');

assert.match(verify, /account_type === 'portal_profile' \? 'portal_'/, 'verified-profile sessions must use the portal session namespace');
assert.match(verify, /account_type === 'capgen_direct' \? 'cg_'/, 'legacy direct customers must have a valid verification/session path');
assert.match(verify, /revoked: false/, 'new returning-member sessions must start explicitly non-revoked');
assert.match(verify, /account_type: identity\.account_type/, 'session persistence must preserve the resolved account type');
assert.doesNotMatch(verify, /No activated Business Center access found/, 'verification must not remain Business Center-only');

// The actual customer login page still uses the historical pipeline-otp route
// names. Those routes must be compatibility facades only; the authoritative
// merged identity logic above owns authorization and session creation.
assert.match(onboarding, /Registered Federal Contractors Portal/, 'login page must use merged portal branding');
assert.match(onboarding, /Federal \+ State Contract Dashboard/, 'login page must identify the merged dashboard');
assert.match(onboarding, /expires in 10 minutes/, 'login page OTP lifetime must match the backend');
assert.match(onboarding, /autocomplete="one-time-code"/, 'OTP input must support one-time-code autofill');
assert.match(onboarding, /pipeline-otp-send/, 'customer login must use the stable compatibility send route');
assert.match(onboarding, /pipeline-otp-verify/, 'customer login must use the stable compatibility verify route');
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

console.log('RFC Portal VAT returning-member recovery and active login-path validation passed.');
