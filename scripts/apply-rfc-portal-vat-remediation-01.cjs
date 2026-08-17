'use strict';

const fs = require('fs');
const path = require('path');

function read(rel) { return fs.readFileSync(path.join(process.cwd(), rel), 'utf8'); }
function write(rel, content) { fs.writeFileSync(path.join(process.cwd(), rel), content, 'utf8'); }
function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`[rfc-vat-01] required marker not found: ${label}`);
  return source.replace(needle, replacement);
}
function replaceRegexRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`[rfc-vat-01] required pattern not found: ${label}`);
  return source.replace(pattern, replacement);
}

let onboarding = read('onboarding.html');
onboarding = onboarding.replace(/<p style="font-size:\.72rem;color:rgba\(255,255,255,\.38\);margin:-8px 0 12px;line-height:1\.5">⌨ Please <strong style="color:rgba\(255,255,255,\.55\)">type<\/strong> your email address — do not paste\.<\/p>/,'<p style="font-size:.72rem;color:rgba(255,255,255,.38);margin:-8px 0 12px;line-height:1.5">Enter or paste your registered business email.</p>');
onboarding = onboarding.replace(/<p style="font-size:\.72rem;color:rgba\(255,255,255,\.38\);margin:-8px 0 12px;line-height:1\.5">⌨ Please <strong style="color:rgba\(255,255,255,\.55\)">type<\/strong> the 6-digit code — do not paste\.<\/p>/,'<p style="font-size:.72rem;color:rgba(255,255,255,.38);margin:-8px 0 12px;line-height:1.5">Enter or paste the 6-digit access code.</p>');
write('onboarding.html', onboarding);

let profileSession = read('netlify/functions/_shared/ngcc-profile-session.mjs');
if (!profileSession.includes('RFC_PORTAL_PIPELINE_SESSION_BRIDGE_V1')) {
  const oldBlock = `export async function loadProfileSession(req) {
  const token = cookieValue(req, PROFILE_COOKIE);
  if (!token) return null;
  const hash = sessionTokenHash(token);
  const rows = await db(
    'natcorp_business_intakes',
    'GET',
    \`?intake_kind=eq.business_profile&session_token_hash=eq.\${encodeURIComponent(hash)}&select=*&limit=1\`,
  );
  const session = rows?.[0] || null;
  if (!session) return null;
  if (session.session_expires_at && new Date(session.session_expires_at).getTime() <= Date.now()) return null;
  return session;
}`;
  const newBlock = `async function loadPipelineProfileSession(req) {
  // RFC_PORTAL_PIPELINE_SESSION_BRIDGE_V1
  const authorization = req.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\\s+(.+)$/i);
  const bearer = match?.[1]?.trim() || '';
  if (!bearer) return null;
  const clientRows = await db('client_sessions','GET',\`?session_token=eq.\${encodeURIComponent(bearer)}&select=email,expires_at&limit=1\`);
  const client = clientRows?.[0] || null;
  if (!client?.email) return null;
  if (client.expires_at && new Date(client.expires_at).getTime() <= Date.now()) return null;
  const email = validEmail(client.email);
  if (!email) return null;
  const intakeRows = await db('natcorp_business_intakes','GET',\`?intake_kind=eq.business_profile&business_email=eq.\${encodeURIComponent(email)}&discovery_status=eq.verified&select=*&order=updated_at.desc&limit=1\`);
  return intakeRows?.[0] || null;
}

export async function loadProfileSession(req) {
  const token = cookieValue(req, PROFILE_COOKIE);
  if (token) {
    const hash = sessionTokenHash(token);
    const rows = await db('natcorp_business_intakes','GET',\`?intake_kind=eq.business_profile&session_token_hash=eq.\${encodeURIComponent(hash)}&select=*&limit=1\`);
    const session = rows?.[0] || null;
    if (session && (!session.session_expires_at || new Date(session.session_expires_at).getTime() > Date.now())) return session;
  }
  return loadPipelineProfileSession(req);
}`;
  profileSession = replaceRequired(profileSession, oldBlock, newBlock, 'profile session loader');
}
write('netlify/functions/_shared/ngcc-profile-session.mjs', profileSession);

let stateMatches = read('netlify/functions/ngcc-state-matches.mjs');
stateMatches = stateMatches.replace("const RELEASE_FILTER = 'natcorp_release_status=eq.eligible&is_latest_version=eq.true&status=eq.open';","const RELEASE_FILTER = 'natcorp_release_status=eq.eligible&is_latest_version=eq.true&status=eq.open&match_readiness_status=eq.MATCH_READY';");
stateMatches = stateMatches.replace("const SELECT = 'select=id,title,description,agency:issuing_organization,solicitation_number:solicitation_number,state_code,jurisdiction_name,place_of_performance_county,naics_codes,procurement_type,response_deadline,posted_at,source_url,official_source_url,acquisition_method';","const SELECT = 'select=id,title,description,agency:issuing_organization,solicitation_number:solicitation_number,state_code,jurisdiction_name,place_of_performance_county,naics_codes,procurement_type,response_deadline,posted_at,source_url,official_source_url,acquisition_method,package_document_count,match_readiness_status';");
stateMatches = stateMatches.replace(`      title: row.title,\n      agency: row.agency,`,`      title: row.title,\n      description: row.description,\n      agency: row.agency,`);
stateMatches = stateMatches.replace(`      acquisition_method: row.acquisition_method,\n      match: matchReason(row, naicsCodes),`,`      acquisition_method: row.acquisition_method,\n      package_document_count: row.package_document_count || 0,\n      match_readiness_status: row.match_readiness_status,\n      naics_codes: row.naics_codes || [],\n      match: matchReason(row, naicsCodes),`);
stateMatches = stateMatches.replace("data_source: { relation: 'State contract inventory — official government records' },","data_source: { relation: 'APIE released state contract inventory — official government records', readiness: 'MATCH_READY' },");
write('netlify/functions/ngcc-state-matches.mjs', stateMatches);

let dashboard = read('ag-dashboard.html');
dashboard = dashboard.replace('Federal Contract Pipeline · NGCC', 'Federal + State Contract Dashboard · Registered Contractors Portal');
dashboard = dashboard.replace('🇺🇸 Federal', '🇺🇸 Federal Contracts');
dashboard = dashboard.replace('◆ Nevada State', '◆ State Contracts');
dashboard = dashboard.replace(/\n  <button class="mkt-tab" data-tab="california">[\s\S]*?<\/button>/,'');
dashboard = dashboard.replace(/\n<!-- California panel -->[\s\S]*?<\/div>\n<\/div>\n\n(?=<\/div><!-- \/app -->)/,'\n');
dashboard = dashboard.replace('<div id="nv-service-panel" style="background:rgba(255,255,255,.04);','<div id="nv-service-panel" style="display:none;background:rgba(255,255,255,.04);');
dashboard = dashboard.replace(/  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:rgba\(255,255,255,\.03\);border:1px solid var\(--line\);border-radius:12px;padding:12px 16px;margin-bottom:18px">\s*<span style="font-size:\.82rem;color:var\(--muted\)">Want the full standalone Nevada experience — saved preferences, email alerts, and more\?<\/span>\s*<a id="nv-explore-link"[\s\S]*?<\/a>\s*<\/div>/,'  <div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:18px"><span style="font-size:.82rem;color:var(--muted)">State opportunities are matched automatically from your verified business capability profile and current released contract inventory.</span></div>');
dashboard = dashboard.replace('Search Nevada bids by title or agency…','Search state contracts by title, agency, or state…');
dashboard = dashboard.replace('No Nevada bids matched your filters.','No state contracts matched your current filters.');
dashboard = dashboard.replace('Could not load Nevada bids. Try again shortly.','Could not load state contract matches. Try again shortly.');
dashboard = dashboard.replace('◆ Nevada State Procurement','◆ State Procurement');
dashboard = dashboard.replace('View full solicitation on the Nevada Procurement Portal','View full solicitation on the official procurement source');
dashboard = dashboard.replace("b.url || 'https://nevada.ionwave.net'","b.url || '#'");
dashboard = dashboard.replace("b.agency || 'Nevada State Agency'","b.agency || 'State Agency'");
dashboard = dashboard.replace("source:      'nevada_ngem'","source:      'apie_state_inventory'");

// Remove dead standalone-state handoff helpers left by the pre-merge dashboard.
dashboard = dashboard.replace(/\n  updateCaExploreLink\(\);\n  updateNvExploreLink\(\);/,'');
dashboard = dashboard.replace(/\n\/\/ Carries the already-authenticated user's identity into CalGovCC[\s\S]*?(?=\/\/ ── Tab switching)/,'\n');
dashboard = dashboard.replace("['federal','nevada','california'].forEach(function(p) {","['federal','nevada'].forEach(function(p) {");

const newLoadNevada = `function loadNevada() {
  var tok = getToken();
  if (!tok) return;
  fetch('/api/state-matches', { headers: { Authorization: 'Bearer ' + tok } })
    .then(function(r) {
      if (r.status === 401) { signOut(); return null; }
      return r.json().then(function(d) { return { ok: r.ok, data: d }; });
    })
    .then(function(result) {
      if (!result) return;
      var d = result.data || {};
      if (!result.ok || !d.ok) throw new Error(d.error || 'State match request failed.');
      nvAll = (Array.isArray(d.results) ? d.results : []).map(function(row) {
        return { id: row.internal_id, bid_id: row.internal_id, title: row.title, description: row.description || '', agency: row.agency, solicitation_no: row.solicitation_number, type: row.procurement_type || 'Contract', close_date: row.response_deadline, issue_date: row.posted_at, url: row.source_url, state_code: row.state_code || '', jurisdiction_name: row.jurisdiction_name || '', naics_codes: row.naics_codes || [], package_document_count: row.package_document_count || 0, match: row.match || null };
      });
      document.getElementById('tab-nv-count').textContent = nvAll.length;
      applyNvFilters();
    })
    .catch(function() { document.getElementById('nv-cards').innerHTML = '<div class="empty-row">Could not load state contract matches. Try again shortly.</div>'; });
}`;
const loadNevadaPattern = /function loadNevada\(\) \{[\s\S]*?\n\}\n\ndocument\.getElementById\('nv-search'\)/;
dashboard = replaceRegexRequired(dashboard, loadNevadaPattern, newLoadNevada + "\n\ndocument.getElementById('nv-search')", 'state pipeline loader');
dashboard = dashboard.replace("var hay = (String(b.title||'') + ' ' + String(b.agency||'')).toLowerCase();","var hay = (String(b.title||'') + ' ' + String(b.agency||'') + ' ' + String(b.state_code||'') + ' ' + String(b.jurisdiction_name||'') + ' ' + String(b.description||'')).toLowerCase();");
dashboard = dashboard.replace("+ '<div class=\"nv-meta\"><span>' + esc(b.agency||'—') + '</span>'","+ '<div class=\"nv-meta\"><span>' + esc(b.agency||'—') + '</span>' + (b.state_code ? '<span class=\"chip chip-naics\">'+esc(b.state_code)+'</span>' : '')");
dashboard = dashboard.replace('Full Pursuit Package','Pursuit Readiness Detail');
dashboard = dashboard.replace('Stage 2 — complete proposal prep','Stage 2 — deeper contract requirements and readiness analysis');
write('ag-dashboard.html', dashboard);

let analyzeFit = read('analyze-fit.html');
analyzeFit = analyzeFit.replace(/PROPOSAL READINESS/g,'PURSUIT READINESS');
analyzeFit = analyzeFit.replace(/proposal resources/g,'pursuit resources');
analyzeFit = analyzeFit.replace(/final bid production/g,'final pursuit authorization');
analyzeFit = analyzeFit.replace(/Proposal Checklist/g,'Response Readiness Checklist');
write('analyze-fit.html', analyzeFit);

console.log('[rfc-vat-01] merger remediation applied; Analyze Fit remains $79.');
