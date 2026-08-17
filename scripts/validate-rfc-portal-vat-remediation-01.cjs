'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const dashboard = read('ag-dashboard.html');
const onboarding = read('onboarding.html');
const profileSession = read('netlify/functions/_shared/ngcc-profile-session.mjs');
const stateMatches = read('netlify/functions/ngcc-state-matches.mjs');
const analyzeFit = read('analyze-fit.html');

assert.match(dashboard, /Federal \+ State Contract Dashboard · Registered Contractors Portal/, 'merged dashboard branding must be visible');
assert.match(dashboard, /State Contracts/, 'dashboard must expose a generalized state-contract tab');
assert.doesNotMatch(dashboard, /data-tab="california"/, 'state availability must not be hard-coded as a separate Coming Soon California tab');
assert.match(dashboard, /fetch\('\/api\/state-matches'/, 'state dashboard must use the shared verified-profile state matching service');
assert.doesNotMatch(dashboard, /fetch\('\/.netlify\/functions\/ngem-pipeline'/, 'merged dashboard must not use the legacy Nevada-only NGEM feed');
assert.doesNotMatch(dashboard, /Open Full Nevada Dashboard/, 'merged portal must not send the primary state workflow to the standalone Nevada site');
assert.match(dashboard, /Search state contracts by title, agency, or state/, 'state search must expose generalized state filtering');
assert.match(dashboard, /state_code/, 'state result rendering must preserve state identity');
assert.match(dashboard, /Purchase a report — \$79/, 'Analyze Fit must retain the current $79 price after Contract Assistance integration');
assert.doesNotMatch(dashboard, /Stage 2 — complete proposal prep/, 'retired proposal-development positioning must not survive in the merged dashboard');
assert.match(dashboard, /Pursuit Readiness Detail/, 'Analyze Fit Stage 2 must remain positioned as readiness analysis');

assert.doesNotMatch(onboarding, /do not paste/i, 'returning-member login must not falsely prohibit paste');
assert.match(onboarding, /Enter or paste your registered business email/, 'returning-member email guidance must reflect actual browser behavior');
assert.match(onboarding, /Enter or paste the 6-digit access code/, 'OTP guidance must reflect actual browser behavior');

assert.match(profileSession, /RFC_PORTAL_PIPELINE_SESSION_BRIDGE_V1/, 'profile session helper must contain the returning-member bridge');
assert.match(profileSession, /client_sessions/, 'profile session bridge must validate the server-side pipeline session');
assert.match(profileSession, /session_token=eq\.\$\{encodeURIComponent\(bearer\)\}&revoked=eq\.false/, 'revoked bearer sessions must be excluded at the database lookup boundary');
assert.match(profileSession, /client\.revoked === true/, 'profile session bridge must fail closed if a revoked session row is ever returned');
assert.match(profileSession, /discovery_status=eq\.verified/, 'pipeline session fallback must resolve only a verified shared business profile');

assert.match(stateMatches, /match_readiness_status=eq\.MATCH_READY/, 'state matching must exclude records the production database marks as not match-ready');
assert.match(stateMatches, /package_document_count/, 'state match response must carry package-document metadata');
assert.match(stateMatches, /APIE released state contract inventory/, 'state matcher must identify the authoritative released inventory boundary');

assert.doesNotMatch(analyzeFit, /PROPOSAL READINESS/, 'Analyze Fit report must not present itself as the retired proposal-development service');
assert.match(analyzeFit, /PURSUIT READINESS/, 'Analyze Fit report must retain pursuit-readiness framing');

console.log('RFC Portal VAT Remediation 01 validation passed with revoked-session rejection and Analyze Fit retained at $79.');
