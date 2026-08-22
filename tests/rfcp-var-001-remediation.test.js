'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20260822143000_rfcp_var_001_security_and_analyze_fit.sql');
const analyze = read('netlify/functions/analyze-fit.mjs');
const background = read('netlify/functions/analyze-fit-background.mjs');
const stateContract = read('netlify/functions/ngcc-state-contract.mjs');

test('authenticated clients cannot grant SAM verification', () => {
  assert.match(migration, /portal_apply_sam_profile[\s\S]*Authoritative server verification is required/);
  assert.match(migration, /revoke all on function public\.portal_apply_sam_profile[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /rfcp_apply_authoritative_sam_verification[\s\S]*request\.jwt\.claim\.role[\s\S]*service_role/);
  assert.match(migration, /verification_event_id text not null unique/);
  assert.match(migration, /source_record_hash text not null/);
});

test('SAM reset is authentication and ownership scoped', () => {
  const reset = migration.match(/create or replace function public\.portal_reset_sam_profile\(\)[\s\S]*?grant execute[^;]+;/)?.[0] || '';
  assert.match(reset, /auth\.uid\(\)/);
  assert.match(reset, /where user_id = v_user/);
  assert.doesNotMatch(reset, /p_user_id/);
  assert.match(reset, /revoke all[^;]+from public, anon/);
});

test('Analyze Fit authorization is server-side, idempotent, and refundable', () => {
  assert.match(migration, /unique \(customer_email, idempotency_key\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /access_type in \('subscription','package','complimentary','authorized_test'\)/);
  assert.match(migration, /product_entitlements[\s\S]*analyze_fit_credit_ledger/);
  assert.match(migration, /rfcp_release_analyze_fit[\s\S]*refund_reversal/);
  assert.match(analyze, /rfcp_reserve_analyze_fit/);
  assert.match(analyze, /rfcp_release_analyze_fit/);
  assert.doesNotMatch(analyze, /function consumeCredit|creditBalance/);
  assert.match(background, /rfcp_complete_analyze_fit/);
  assert.match(background, /rfcp_release_analyze_fit/);
});

test('Federal and State/local identifiers cannot collide', () => {
  assert.match(analyze, /opportunityKey = `\$\{source\}:\$\{opportunityId\}`/);
  assert.match(analyze, /state_local/);
  assert.match(analyze, /sam_opportunities/);
  assert.match(analyze, /state_contract_opportunities/);
  assert.doesNotMatch(analyze, /inlineOpp|opportunity:inline/);
});

test('State/local flow preserves inventory provenance and truthful package state', () => {
  assert.match(stateContract, /inventory_source: 'state_local'/);
  assert.match(stateContract, /source_opportunity_id: row\.id/);
  assert.match(stateContract, /available_not_asserted_complete/);
  assert.match(stateContract, /SAM NAICS did not contribute/);
  assert.match(read('state-contract.html'), /source=state_local/);
  assert.match(read('state-contract.html'), /will not imply a complete package/);
  assert.match(read('analyze-fit.html'), /inventorySource/);
});

test('matching explanations state source, basis, evidence, and limitations', () => {
  const federal = read('netlify/functions/ngcc-federal-matches.mjs');
  const state = read('netlify/functions/ngcc-state-matches.mjs');
  for (const field of ['source:', 'contractor_capability:', 'basis:', 'evidence:', 'limitations:']) {
    assert.match(federal, new RegExp(field));
    assert.match(state, new RegExp(field));
  }
  assert.match(federal, /sam_derived_naics/);
  assert.match(state, /business_capability_keywords/);
  assert.match(state, /SAM NAICS did not contribute/);
});

test('operator HTML is denied at the edge until an unexpired operator cookie verifies', () => {
  const edge = read('netlify/edge-functions/rfcp-operator-auth.js');
  const auth = read('netlify/functions/ngcc-ops-auth.js');
  for (const path of ['ops-command-center-v3.html', 'ops-command-center-v5.html', 'ops-dashboard.html', 'ops-outreach.html']) assert.match(edge, new RegExp(path.replace('.', '\\.')));
  assert.match(edge, /exp <= Math\.floor\(Date\.now\(\) \/ 1000\)/);
  assert.match(edge, /crypto\.subtle\.verify/);
  assert.match(edge, /operator-login\.html/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Strict/);
});

test('CSP is restrictive and report-only for preview validation', () => {
  const netlify = read('netlify.toml');
  assert.match(netlify, /Content-Security-Policy-Report-Only/);
  assert.match(netlify, /default-src 'self'/);
  assert.match(netlify, /object-src 'none'/);
  assert.match(netlify, /frame-ancestors 'none'/);
  assert.doesNotMatch(netlify, /default-src \*/);
});
