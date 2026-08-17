'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

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
assert.match(send, /Registered Federal Contractors Portal/, 'returning-member email must use merged portal branding');
assert.match(send, /Federal \+ State Contract Dashboard/, 'returning-member email must describe the merged dashboard');
assert.doesNotMatch(send, /access your Federal CapGen dashboard/, 'legacy Federal CapGen customer wording must not survive');

assert.match(verify, /account_type === 'portal_profile' \? 'portal_'/, 'verified-profile sessions must use the portal session namespace');
assert.match(verify, /account_type === 'capgen_direct' \? 'cg_'/, 'legacy direct customers must have a valid verification/session path');
assert.match(verify, /revoked: false/, 'new returning-member sessions must start explicitly non-revoked');
assert.match(verify, /account_type: identity\.account_type/, 'session persistence must preserve the resolved account type');
assert.doesNotMatch(verify, /No activated Business Center access found/, 'verification must not remain Business Center-only');

console.log('RFC Portal VAT Remediation 04 returning-member recovery validation passed.');
