const fs = require('fs');
const path = require('path');

function patchQualificationV2() {
  const target = path.join(process.cwd(), 'ops-command-center-v5.html');
  let source = fs.readFileSync(target, 'utf8');

  const alreadyApplied = "const qualificationUiStart=html.indexOf(\"function renderRanked(){\")";
  if (source.includes(alreadyApplied)) {
    console.log('[ngcc-qualification-v2-ui] Stage 05 patch already present; no changes needed.');
    return;
  }

  const insertionMarker = "    const executionTail = '<div id=\"execMsg\" class=\"msg\"></div><div id=\"stageOutput\"></div></section>';";
  if (!source.includes(insertionMarker)) {
    throw new Error('[ngcc-qualification-v2-ui] required v5 insertion marker was not found.');
  }

  const uiPatch = `    // Stage 05 v2: distinguish why a business was discovered from whether
    // current evidence shows it can perform this specific contract. A missing
    // qualification score is rendered as "Not scored" rather than a false 50%.
    const qualificationUiStart=html.indexOf("function renderRanked(){");
    const qualificationUiEnd=html.indexOf("function renderContacts(){",qualificationUiStart);
    if(qualificationUiStart<0||qualificationUiEnd<0)throw new Error('Stage 05 qualification v2 UI markers were not found.');
    const qualificationUiFunction=\`function renderRanked(){const rows=evidence.ranked_candidates||[];if(!rows.length){$('ranked').innerHTML='<div class="muted">No Stage 05 output yet.</div>';return}const q=v=>Number.isFinite(Number(v))?Number(v):null;$('ranked').innerHTML=\\\`<table><thead><tr><th>Select</th><th>Rank</th><th>Business</th><th>Discovery Match</th><th>Contract Qualification</th><th>Status</th><th>Evidence</th></tr></thead><tbody>\\\${rows.map((c,i)=>{const discovery=q(c.discovery_match_score);const qualification=q(c.contract_qualification_score??c.qualification_score);const coverage=q(c.evidence_coverage_percentage);const visualStatus=c.qualification_status==='INSUFFICIENT_EVIDENCE'?'REVIEW_REQUIRED':c.qualification_status;return\\\`<tr><td><input type="checkbox" data-rank-select="\\\${i}" \\\${c.operator_selected?'checked':''} \\\${c.qualification_status==='DISQUALIFIED'?'disabled':''}></td><td>\\\${esc(c.rank)}</td><td><b>\\\${esc(c.business_name)}</b><br>\\\${esc(c.city||'')}\\\${c.state?', '+esc(c.state):''}</td><td><b>\\\${discovery===null?'—':esc(discovery)+'/100'}</b><br><small>\\\${esc(c.discovery_match_status||'Discovery evidence')}</small></td><td><b>\\\${qualification===null?'Not scored':esc(qualification)+'/100'}</b><br><small>\\\${coverage===null?'Evidence coverage unavailable':esc(coverage)+'% evidence coverage'}</small></td><td><span class="pill \\\${esc(visualStatus)}">\\\${esc(c.qualification_status)}</span></td><td><details><summary>Why ranked</summary>\\\${(c.explanation?.why_ranked||[]).map(x=>\\\`<div>• \\\${esc(x)}</div>\\\`).join('')}<div class="warntext">\\\${(c.explanation?.verification_required||[]).filter(x=>x.status==='UNVERIFIED').length} verification item(s)</div>\\\${(c.explanation?.verification_required||[]).filter(x=>x.status==='MISMATCH').length?\\\`<div class="err">\\\${(c.explanation?.verification_required||[]).filter(x=>x.status==='MISMATCH').length} affirmative mismatch(es)</div>\\\`:''}</details></td></tr>\\\`}).join('')}</tbody></table>\\\`;document.querySelectorAll('[data-rank-select]').forEach(el=>el.onchange=()=>{const selected=[...document.querySelectorAll('[data-rank-select]:checked')];if(el.checked&&selected.length>5){el.checked=false;alert('Stage 06 is limited to five businesses per controlled website research run.');return}evidence.ranked_candidates[Number(el.dataset.rankSelect)].operator_selected=el.checked;saveEvidence();render()})}\`;
    html=html.slice(0,qualificationUiStart)+qualificationUiFunction+html.slice(qualificationUiEnd);

`;

  source = source.replace(insertionMarker, uiPatch + insertionMarker);
  fs.writeFileSync(target, source, 'utf8');
  console.log('[ngcc-qualification-v2-ui] Stage 05 now shows Discovery Match and Contract Qualification separately.');
}

function patchStage06WebsiteUi() {
  const target = path.join(process.cwd(), 'ops-command-center-v3.html');
  let source = fs.readFileSync(target, 'utf8');

  if (source.includes("CONTACT_DISCOVERY:'Website & Contact Discovery'")) {
    console.log('[ngcc-stage06-website-ui] patch already present; no changes needed.');
    return;
  }

  const replaceRequired = (needle, replacement, label) => {
    if (!source.includes(needle)) throw new Error(`[ngcc-stage06-website-ui] required marker not found: ${label}`);
    source = source.replace(needle, replacement);
  };

  replaceRequired(
    "CONTACT_DISCOVERY:'Contact Discovery'",
    "CONTACT_DISCOVERY:'Website & Contact Discovery'",
    'Stage 06 label'
  );

  replaceRequired(
    '<section class="card"><div class="tag">Stage 05 → 06 Gate</div><h2>Ranked contractors — select for contact discovery</h2><p class="section-note">Ranking is not authorization. Select only businesses you want investigated for a public contact.</p><div id="ranked"><div class="muted">No Stage 05 output yet.</div></div></section>',
    '<section class="card"><div class="tag">Stage 05 → 06 Gate</div><h2>Ranked contractors — select for website verification</h2><p class="section-note">Ranking is not authorization. Select up to five businesses for Stage 06. The Agent will locate each official business website, verify current capability evidence, and search for a published public email. INSUFFICIENT_EVIDENCE may be refreshed by this deeper website review; missing evidence remains unresolved rather than guessed.</p><div id="ranked"><div class="muted">No Stage 05 output yet.</div></div></section>',
    'Stage 05 to 06 gate copy'
  );

  replaceRequired(
    '<section class="card"><div class="tag">Stage 06 → 07 Gate</div><h2>Verified contacts — approve for outreach</h2><p class="section-note">A verified email is evidence, not permission to send. Approve outreach separately. Existing TEST MODE remains authoritative.</p><div id="contacts"><div class="muted">No Stage 06 output yet.</div></div></section>',
    '<section class="card"><div class="tag">Stage 06 · Website & Contact Discovery</div><h2>Official website research — approve verified contacts for outreach</h2><p class="section-note">Stage 06 is website-first. A verified email requires a published public address plus source URL. Website evidence may refresh Contract Qualification, but a verified email is still not permission to send. Approve outreach separately. Existing TEST MODE remains authoritative.</p><div id="contacts"><div class="muted">No Stage 06 output yet.</div></div></section>',
    'Stage 06 to 07 gate copy'
  );

  replaceRequired(
    "async function executeActive(){const step=currentStep();if(!step)return;$('execute').disabled=true;$('execMsg').className='msg';$('execMsg').textContent='Executing…';try{await transition(step.step_code,'RUNNING',{progress_percentage:5,current_activity:`Executing ${STEP_LABELS[step.step_code]}`});let result;",
    "async function executeActive(){const step=currentStep();if(!step)return;$('execute').disabled=true;$('execMsg').className='msg';$('execMsg').textContent='Executing…';const startActivity=step.step_code==='CONTACT_DISCOVERY'?'Agent is locating official business websites, reviewing current capability evidence, and finding published public email addresses.':`Executing ${STEP_LABELS[step.step_code]}`;try{await transition(step.step_code,'RUNNING',{progress_percentage:5,current_activity:startActivity});let result;",
    'Stage execution activity'
  );

  replaceRequired(
    "else if(step.step_code==='CONTACT_DISCOVERY')result=await req('/.netlify/functions/ngcc-ops-contact-discovery',{method:'POST',body:JSON.stringify({candidates:evidence.ranked_candidates||[],limit:10})});",
    "else if(step.step_code==='CONTACT_DISCOVERY')result=await req('/.netlify/functions/ngcc-ops-contact-discovery',{method:'POST',body:JSON.stringify({candidates:evidence.ranked_candidates||[],contract_dna:evidence.contract_dna,business_search_dna:evidence.business_search_dna,limit:5})});",
    'Stage 06 request payload'
  );

  replaceRequired(
    "if(step.step_code==='CONTACT_DISCOVERY')evidence.contacts=(result.contacts||[]).map(c=>({...c,outreach_approved:false}));",
    "if(step.step_code==='CONTACT_DISCOVERY'){if(Array.isArray(result.ranked_candidates))evidence.ranked_candidates=result.ranked_candidates.map(c=>({...c,operator_selected:c.operator_selected===true}));evidence.contacts=(result.contacts||[]).map(c=>({...c,outreach_approved:false}));}",
    'Stage 06 evidence refresh'
  );

  const contactsStart = source.indexOf('function renderContacts(){');
  const contactsEnd = source.indexOf('function renderOutreach(){', contactsStart);
  if (contactsStart < 0 || contactsEnd < 0) throw new Error('[ngcc-stage06-website-ui] renderContacts markers were not found.');

  const renderContacts = `function renderContacts(){const rows=evidence.contacts||[];if(!rows.length){$('contacts').innerHTML='<div class="muted">No Stage 06 output yet.</div>';return}$('contacts').innerHTML=\`<table><thead><tr><th>Approve</th><th>Business</th><th>Website Research</th><th>Contact Status</th><th>Email</th><th>Evidence</th></tr></thead><tbody>\${rows.map((c,i)=>{const pages=Array.isArray(c.website_pages_checked)?c.website_pages_checked.length:0;const refreshed=c.capability_verification?'Capability evidence refreshed':'No new capability evidence';return\`<tr><td><input type="checkbox" data-contact-approve="\${i}" \${c.outreach_approved?'checked':''} \${c.contact_status!=='VERIFIED'?'disabled':''}></td><td><b>\${esc(c.business_name)}</b><br><small>\${esc(c.qualification_status||'')}</small></td><td>\${c.official_website_url?\`<a href="\${esc(c.official_website_url)}" target="_blank" rel="noopener" style="color:#fff">Official website</a>\`:'<span class="warntext">Official website not verified</span>'}<br><small>\${pages} page(s) checked · \${esc(refreshed)}</small></td><td><span class="pill \${esc(c.contact_status)}">\${esc(c.contact_status)}</span></td><td>\${esc(c.contact_email||'—')}</td><td>\${c.source_url?\`<a href="\${esc(c.source_url)}" target="_blank" rel="noopener" style="color:#fff">Email source</a>\`:'—'}<br><small>\${esc(c.evidence_note||'')}</small></td></tr>\`}).join('')}</tbody></table>\`;document.querySelectorAll('[data-contact-approve]').forEach(el=>el.onchange=()=>{evidence.contacts[Number(el.dataset.contactApprove)].outreach_approved=el.checked;saveEvidence();render()})}\n`;

  source = source.slice(0, contactsStart) + renderContacts + source.slice(contactsEnd);
  fs.writeFileSync(target, source, 'utf8');
  console.log('[ngcc-stage06-website-ui] Stage 06 now visibly performs website-first capability and contact research.');
}

patchQualificationV2();
patchStage06WebsiteUi();
require('./apply-ngcc-persistent-agent-ui.cjs');
