'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const dashboard = read('dashboard.html');
const onboarding = read('onboarding.html');
const analyzePage = read('analyze-fit.html');
const orchestrator = read('netlify/functions/analyze-fit.mjs');
const background = read('netlify/functions/analyze-fit-background.mjs');
const docx = read('netlify/functions/analyze-fit-docx.mjs');
const bridge = read('netlify/functions/ngcc-profile-session-bridge.mjs');
const adapter = read('netlify/functions/_shared/ngcc-analyze-profile.mjs');
const toml = read('netlify.toml');

assert.match(onboarding, /window\.location\.assign\('\/dashboard\.html'\)/, 'returning member login must open the canonical dashboard');
assert.doesNotMatch(onboarding, /window\.location\.assign\('\/apropos'\)/, 'returning member login must not open the legacy dashboard alias');

assert.match(dashboard, /\/api\/profile-session-bridge/, 'canonical dashboard must bridge a verified cookie session to customer bearer auth');
assert.match(dashboard, /pipeline_session/, 'canonical dashboard must preserve the compatible customer session token');
assert.match(dashboard, /Authorization:'Bearer '\+customerToken/, 'canonical dashboard must send bearer auth for returning-member compatibility');
assert.match(dashboard, /Analyze Fit — \$79/, 'Federal dashboard must preserve the current $79 Analyze Fit price');
assert.match(dashboard, /\/analyze-fit\?id=/, 'Federal dashboard must hand a stable notice ID to Analyze Fit');
assert.match(dashboard, /State Contract Matches/, 'canonical dashboard must retain the state search experience');

assert.match(bridge, /account_type: 'portal_profile'/, 'profile-session bridge must remain entitlement-neutral');
assert.doesNotMatch(bridge, /account_type: 'subscriber'/, 'profile-session bridge must not grant subscription semantics');
assert.match(bridge, /sameOrigin\(req\)/, 'profile-session bridge must be same-origin protected');
assert.match(bridge, /discovery_status !== 'verified'/, 'profile-session bridge must require a verified shared profile');

assert.match(adapter, /merged_verified_profile/, 'Analyze Fit adapter must identify the merged verified profile source');
assert.match(adapter, /natcorp_business_intakes/, 'Analyze Fit adapter must read the shared verified intake/profile authority');

for (const [name, source] of [['orchestrator', orchestrator], ['background', background], ['docx', docx]]) {
  assert.match(source, /ngcc-analyze-profile\.mjs/, `${name} must use the merged Analyze Fit profile adapter`);
  assert.ok(source.indexOf('loadMergedAnalyzeProfile') < source.lastIndexOf('demo_snapshots'), `${name} must prefer the merged profile before legacy snapshot fallback`);
}
assert.match(orchestrator, /OUT_OF_CREDITS/, 'Analyze Fit $79 credit gate must remain in force');
assert.match(orchestrator, /analyze_fit_credit_ledger/, 'Analyze Fit credit ledger must remain authoritative');

assert.match(analyzePage, /sessionStorage\.getItem\('pipeline_session'\)/, 'Analyze Fit page must accept the canonical portal session');
assert.match(analyzePage, /\/api\/capability-profile/, 'Analyze Fit page must load merged verified profile context');
assert.match(analyzePage, /Pursuit Readiness Plan/, 'customer report must use pursuit-readiness product framing');
assert.doesNotMatch(analyzePage, /Proposal Development Plan/, 'retired standalone Proposal Development framing must not reappear');

assert.match(toml, /from = "\/apropos"[\s\S]*?to = "\/dashboard\.html"/, 'legacy /apropos alias must resolve to the canonical dashboard');
assert.match(toml, /from = "\/ag-dashboard\.html"[\s\S]*?to = "\/dashboard\.html"/, 'direct legacy customer dashboard path must redirect to canonical dashboard');

console.log('RFC Portal VAT Remediation 02 validation passed.');
