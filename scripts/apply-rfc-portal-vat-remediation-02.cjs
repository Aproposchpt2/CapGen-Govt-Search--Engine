'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const write = (rel, value) => fs.writeFileSync(path.join(root, rel), value, 'utf8');
function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`[rfc-vat-02] required marker not found: ${label}`);
  return source.replace(needle, replacement);
}
function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`[rfc-vat-02] start marker not found: ${label}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`[rfc-vat-02] end marker not found: ${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

// ---------------------------------------------------------------------------
// 1) Returning-member login converges on the canonical merged dashboard.
// ---------------------------------------------------------------------------
let onboarding = read('onboarding.html');
onboarding = onboarding.replace("setTimeout(()=>{window.location.assign('/apropos');},400);", "setTimeout(()=>{window.location.assign('/dashboard.html');},400);");
write('onboarding.html', onboarding);

// ---------------------------------------------------------------------------
// 2) Canonical dashboard supports cookie-first new users and bearer returning
//    users, and preserves Federal Analyze Fit at the current $79 price.
// ---------------------------------------------------------------------------
let dashboard = read('dashboard.html');
dashboard = replaceRequired(
  dashboard,
  'let profile=null,federal=[],state=[];',
  `let profile=null,federal=[],state=[],customerToken=sessionStorage.getItem('pipeline_session')||localStorage.getItem('pipeline_session')||'';
const authHeaders=()=>customerToken?{Accept:'application/json',Authorization:'Bearer '+customerToken}:{Accept:'application/json'};
async function ensureCustomerToken(){
  if(customerToken)return customerToken;
  const response=await fetch('/api/profile-session-bridge',{method:'POST',headers:{Accept:'application/json'}}),result=await response.json().catch(()=>({}));
  if(!response.ok||!result.session_token)throw new Error(result.error||'Your verified business session could not be opened.');
  customerToken=result.session_token;
  sessionStorage.setItem('pipeline_session',customerToken);localStorage.setItem('pipeline_session',customerToken);
  const existing=JSON.parse(sessionStorage.getItem('capgen_session')||'{}');
  sessionStorage.setItem('capgen_session',JSON.stringify({...existing,session_token:customerToken,business_name:result.business_name||existing.business_name||'',email:result.email||existing.email||''}));
  return customerToken;
}`,
  'dashboard customer session state',
);
dashboard = dashboard.replace("fetch('/api/capability-profile',{headers:{Accept:'application/json'}})", "fetch('/api/capability-profile',{headers:authHeaders()})");
dashboard = dashboard.replace("fetch('/api/federal-matches',{headers:{Accept:'application/json'}})", "fetch('/api/federal-matches',{headers:authHeaders()})");
dashboard = dashboard.replace("fetch('/api/state-matches',{headers:{Accept:'application/json'}})", "fetch('/api/state-matches',{headers:authHeaders()})");

dashboard = replaceBetween(
  dashboard,
  'function renderFederal(){',
  'function renderState(){',
  `function openFederalAnalyzeFit(row){
  if(!row?.notice_id)return;
  sessionStorage.setItem('analyze_opp',JSON.stringify({title:row.title,agency:row.agency,naics:row.naics_code||((row.matched_naics||[])[0]||''),set_aside:row.set_aside,response_deadline:row.response_deadline,solicitation_number:row.solicitation_number,notice_id:row.notice_id}));
  location.assign('/analyze-fit?id='+encodeURIComponent(row.notice_id));
}
function renderFederal(){const root=$('federalResults');if(!federal.length){root.innerHTML='<div class="empty">No live federal opportunities currently match your confirmed NAICS codes.</div>';return}root.innerHTML=federal.map(r=>{const days=daysUntil(r.response_deadline),notice=esc(r.notice_id||'');return \`<article class="card"><div class="tags"><span class="tag strong">NAICS \${esc((r.matched_naics||[]).join(', '))}</span>\${r.set_aside?\`<span class="tag">\${esc(r.set_aside)}</span>\`:''}\${days!=null?\`<span class="tag \${days<=7?'soon':''}">\${days>=0?days+' days left':'Deadline passed'}</span>\`:''}</div><h3>\${esc(r.title)}</h3><div class="meta">\${esc(r.agency)} · \${esc(r.solicitation_number||'Solicitation not provided')} · Posted \${esc(formatDate(r.posted_at))} · Due \${esc(formatDate(r.response_deadline))}</div><div class="card-actions">\${r.ui_link?\`<a class="btn ghost" href="\${esc(r.ui_link)}" target="_blank" rel="noopener">View Official Listing →</a>\`:''}\${notice?\`<button class="btn ghost" type="button" data-analyze="\${notice}">Analyze Fit — $79 →</button>\`:''}</div></article>\`}).join('');root.querySelectorAll('[data-analyze]').forEach(button=>button.addEventListener('click',()=>{const row=federal.find(item=>String(item.notice_id||'')===button.dataset.analyze);if(row)openFederalAnalyzeFit(row)}))}
`,
  'canonical federal result rendering',
);
dashboard = dashboard.replace('async function init(){try{profile=await getProfile()}', 'async function init(){try{await ensureCustomerToken();profile=await getProfile()}');
write('dashboard.html', dashboard);

// ---------------------------------------------------------------------------
// 3) Analyze Fit browser report accepts the canonical bearer token and loads
//    the merged verified profile for readable report context.
// ---------------------------------------------------------------------------
let analyzePage = read('analyze-fit.html');
analyzePage = analyzePage.replace(
  "sessionToken=session?.session_token||''",
  "sessionToken=session?.session_token||sessionStorage.getItem('pipeline_session')||localStorage.getItem('pipeline_session')||''",
);
analyzePage = analyzePage.replace(
  "$('backBtn').href=token?'/opportunity?t='+encodeURIComponent(token):'/opportunity';",
  "$('backBtn').href=sessionToken?'/dashboard.html':(token?'/opportunity?t='+encodeURIComponent(token):'/dashboard.html');",
);
analyzePage = analyzePage.replace(
  'async function loadContext(){if(token&&!betaToken)',
  `async function loadContext(){if(sessionToken){try{const r=await fetch('/api/capability-profile',{headers:{Accept:'application/json',Authorization:'Bearer '+sessionToken}});if(r.ok){const d=await r.json(),v=d.session?.verified_profile||{};profile={legal_name:v.legal_name||v.business_name||d.session?.business_name||'',business_name:v.business_name||d.session?.business_name||'',naics:v.naics_codes||[],capabilities:[...(v.capabilities||[]),...(v.services||[]),...(v.products||[]),...(v.core_competencies||[])].map(x=>typeof x==='object'?x.name:x).filter(Boolean).join('; '),past_performance:v.past_performance||'Not specified',keywords:v.keywords||v.procurement_terms||[]}}}catch{}}if(token&&!betaToken)`,
);
analyzePage = analyzePage.replace(/Proposal Development Plan/g, 'Pursuit Readiness Plan');
write('analyze-fit.html', analyzePage);

// ---------------------------------------------------------------------------
// 4) Analyze Fit orchestrator: merged verified profile satisfies the profile
//    gate; legacy demo snapshot remains a fallback for existing customers.
// ---------------------------------------------------------------------------
let orchestrator = read('netlify/functions/analyze-fit.mjs');
if (!orchestrator.includes("./_shared/ngcc-analyze-profile.mjs")) {
  orchestrator = "import { loadMergedAnalyzeProfile } from './_shared/ngcc-analyze-profile.mjs';\n" + orchestrator;
}
const gateStart = 'if(!isBeta){const snaps=await sbGet(`demo_snapshots?requester_email=eq.${encodeURIComponent(accountEmail)}&status=eq.complete&order=created_at.desc&limit=1`);if(!snaps.length)return{statusCode:409,headers:CORS,body:JSON.stringify({error:\'PROFILE_REQUIRED\'})}}';
orchestrator = replaceRequired(
  orchestrator,
  gateStart,
  "if(!isBeta){const mergedProfile=await loadMergedAnalyzeProfile(sbGet,accountEmail);if(!mergedProfile){const snaps=await sbGet(`demo_snapshots?requester_email=eq.${encodeURIComponent(accountEmail)}&status=eq.complete&order=created_at.desc&limit=1`);if(!snaps.length)return{statusCode:409,headers:CORS,body:JSON.stringify({error:'PROFILE_REQUIRED'})}}}",
  'Analyze Fit merged profile gate',
);
write('netlify/functions/analyze-fit.mjs', orchestrator);

// ---------------------------------------------------------------------------
// 5) Analyze Fit background: merged verified profile first, legacy snapshot
//    fallback second. No duplicate business profile is created.
// ---------------------------------------------------------------------------
let background = read('netlify/functions/analyze-fit-background.mjs');
if (!background.includes("./_shared/ngcc-analyze-profile.mjs")) {
  background = "import { loadMergedAnalyzeProfile } from './_shared/ngcc-analyze-profile.mjs';\n" + background;
}
const bgStart = "    } else {\n      const snaps = await sbGet(`demo_snapshots?requester_email=eq.${encodeURIComponent(accountEmail)}&order=created_at.desc&limit=1`);";
const bgEnd = '\n    }\n\n    // Load existing row';
const bgReplacement = `    } else {
      profile = await loadMergedAnalyzeProfile(sbGet, accountEmail);
      if (!profile) {
        const snaps = await sbGet(\`demo_snapshots?requester_email=eq.\${encodeURIComponent(accountEmail)}&order=created_at.desc&limit=1\`);
        if (!snaps.length) {
          await sbPatch(markFilter, { status: 'failed', stage1: { error: 'Profile not found' } });
          return { statusCode: 200, body: 'no profile' };
        }
        const snap = snaps[0];
        const rawProf = snap.profile || {};
        profile = {
          business_name: rawProf.legal_name || snap.business_name || '',
          uei: rawProf.uei || '',
          cage: rawProf.cage || '',
          naics: (rawProf.naics || []).map(n => n.code || n),
          set_asides: rawProf.set_asides || [],
          certifications: rawProf.set_asides || [],
          capabilities: rawProf.capabilities || 'Not specified',
          past_performance: rawProf.past_performance || 'Not specified',
          team_size: rawProf.team_size || 'Not specified',
          keywords: rawProf.keywords || [],
        };
      }`;
background = replaceBetween(background, bgStart, bgEnd, bgReplacement, 'Analyze Fit background merged profile loader');
write('netlify/functions/analyze-fit-background.mjs', background);

// ---------------------------------------------------------------------------
// 6) DOCX output uses the same merged profile adapter, with legacy fallback.
// ---------------------------------------------------------------------------
let docx = read('netlify/functions/analyze-fit-docx.mjs');
if (!docx.includes("./_shared/ngcc-analyze-profile.mjs")) {
  docx = docx.replace("import { buildAnalyzeFitDocx, analyzeFitDocxFilename } from './lib/analyze-fit-docx.mjs';", "import { buildAnalyzeFitDocx, analyzeFitDocxFilename } from './lib/analyze-fit-docx.mjs';\nimport { loadMergedAnalyzeProfile } from './_shared/ngcc-analyze-profile.mjs';");
}
const docxStart = 'async function loadProfile(account){';
const docxEnd = '\n\nexport const handler=';
const docxLoader = `async function loadProfile(account){
  if(account.isBeta){const rows=await sbGet(\`beta_testers?email=eq.\${encodeURIComponent(account.email)}&limit=1\`);const t=rows[0];if(!t)return null;return{business_name:t.company_name||'',legal_name:t.company_name||'',cage:t.cage_code||'',naics:[t.primary_naics,...(t.additional_naics||[])].filter(Boolean),set_asides:[],certifications:[],capabilities:'IT services, computer systems design',past_performance:'Not specified',team_size:'Not specified',keywords:[]}}
  const merged=await loadMergedAnalyzeProfile(sbGet,account.email);if(merged)return merged;
  const rows=await sbGet(\`demo_snapshots?requester_email=eq.\${encodeURIComponent(account.email)}&status=eq.complete&order=created_at.desc&limit=1\`);const snap=rows[0];if(!snap)return null;const p=snap.profile||{};return{...p,business_name:p.legal_name||snap.business_name||p.business_name||'',legal_name:p.legal_name||snap.business_name||p.business_name||'',naics:(p.naics||[]).map(n=>n?.code||n),capabilities:p.capabilities||'Not specified',past_performance:p.past_performance||'Not specified'}
}`;
docx = replaceBetween(docx, docxStart, docxEnd, docxLoader, 'Analyze Fit DOCX merged profile loader');
write('netlify/functions/analyze-fit-docx.mjs', docx);

// ---------------------------------------------------------------------------
// 7) Public portal identity reflects the completed Federal + State merger.
//    Keep the historical /ngcc purchasing route for compatibility, but the
//    public product name and canonical domain are the Registered Federal
//    Contractors Portal at federalcontractorportal.aproposgroupllc.com.
// ---------------------------------------------------------------------------
let publicHome = read('index.html');
publicHome = publicHome.replaceAll('https://ngcc.aproposgroupllc.com/', 'https://federalcontractorportal.aproposgroupllc.com/');
publicHome = publicHome.replaceAll('Federal Contract Matching for Registered Contractors | Registered Federal Contractors Portal', 'Federal + State Contract Opportunities for Registered Contractors | Registered Federal Contractors Portal');
publicHome = publicHome.replace('Registered federal contractors receive personalized federal contract matches, intelligent rankings, guided onboarding, Analyze Fit support, and a 14-day free trial.', 'Registered federal contractors receive personalized federal opportunities plus released state contract opportunities, intelligent rankings, guided onboarding, Analyze Fit support, and a 14-day free trial.');
publicHome = publicHome.replace('Registered federal contractors receive guided onboarding, personalized federal contract matches, intelligent rankings, and Analyze Fit support.', 'Registered federal contractors receive guided onboarding, personalized federal opportunities, released state contract opportunities, intelligent rankings, and Analyze Fit support.');
publicHome = publicHome.replace('Guided federal contractor onboarding, personalized opportunity matching, intelligent rankings, and Analyze Fit support.', 'Guided contractor onboarding, personalized federal and released state opportunity matching, intelligent rankings, and Analyze Fit support.');
publicHome = publicHome.replace('Registered Federal Contractors Portal federal procurement intelligence platform', 'Registered Federal Contractors Portal Federal + State procurement intelligence platform');
publicHome = publicHome.replace('"alternateName":"NGCC"', '"alternateName":"Registered Federal Contractors Portal"');
publicHome = publicHome.replace('"name":"Federal Contract Matching for Registered Contractors","serviceType":"Personalized federal procurement opportunity matching"', '"name":"Federal + State Contract Opportunities for Registered Contractors","serviceType":"Personalized federal opportunity matching plus released state contract opportunity access"');
publicHome = publicHome.replace('Apropos Group LLC · Federal Procurement Intelligence', 'Apropos Group LLC · Federal + State Procurement Intelligence');
publicHome = publicHome.replace('Federal contract matching for registered contractors.', 'Federal + State contract opportunities for registered contractors.');
publicHome = publicHome.replace('The Registered Federal Contractors Portal serves registered federal contractors. NAT-CORP serves licensed contractors seeking applicable state and local opportunities.', 'The Registered Federal Contractors Portal serves registered federal contractors with personalized federal opportunities plus released state contract opportunities available through the portal. NAT-CORP remains the dedicated state and local contract-intelligence product for licensed contractors.');
publicHome = publicHome.replace('Your federal business profile becomes the foundation for opportunity matching.', 'Your registered business profile becomes the foundation for Federal + State opportunity matching.');
publicHome = publicHome.replace('The Registered Federal Contractors Portal organizes federal opportunities around your capabilities, NAICS classifications, certifications, and procurement readiness.', 'The Registered Federal Contractors Portal organizes personalized federal opportunities and released state contract opportunities around your capabilities, NAICS classifications, certifications, and procurement readiness.');
publicHome = publicHome.replace('Federal capability-profile matching', 'Federal + State capability-profile matching');
publicHome = publicHome.replace('Personalized federal contract dashboard', 'Personalized Federal + State Contract Dashboard');
publicHome = publicHome.replace("Your active monthly membership provides continued access to the Portal's guided federal procurement experience.", "Your active monthly membership provides continued access to the Portal's guided Federal + State procurement experience.");
publicHome = publicHome.replace('A guided path from contractor identification to an informed federal opportunity decision.', 'A guided path from contractor identification to informed Federal + State opportunity decisions.');
publicHome = publicHome.replace('Build Your Federal Profile', 'Build Your Business Profile');
publicHome = publicHome.replace('Your personalized dashboard organizes federal', 'Your personalized Federal + State dashboard organizes federal');
write('index.html', publicHome);

console.log('[rfc-vat-02] canonical dashboard/session, merged Analyze Fit profile integration, and public Federal + State portal identity applied.');
