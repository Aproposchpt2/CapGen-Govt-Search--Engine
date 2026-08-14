const fs = require('fs');
const path = require('path');

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start >= 0 ? start + startMarker.length : 0);
  if (start < 0 || end < 0) throw new Error(`[ngcc-research-routing] ${label} markers were not found.`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceSection(source, startMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) return source;
  const end = source.indexOf('</section>', start);
  if (end < 0) throw new Error(`[ngcc-research-routing] ${label} closing section was not found.`);
  return source.slice(0, start) + replacement + source.slice(end + '</section>'.length);
}

function patchV3() {
  const target = path.join(process.cwd(), 'ops-command-center-v3.html');
  let source = fs.readFileSync(target, 'utf8');

  source = source.replace(
    "CONTACT_DISCOVERY:'Website & Contact Discovery'",
    "CONTACT_DISCOVERY:'Contractor Research & Contact Discovery'"
  );

  source = replaceSection(
    source,
    '<section class="card"><div class="tag">Stage 05 → 06 Gate',
    '<section class="card"><div class="tag">Stage 04 → 05 Gate</div><h2>SAM contractors — automatic research queue</h2><p class="section-note">All persisted SAM contractor candidates enter Stage 05 research by default. Five workers run concurrently and continuously process the full queue; five is the worker count, not a five-business ceiling.</p><div id="ranked"><div class="muted">No contractor candidates yet.</div></div></section>',
    'ranked contractor section'
  );

  source = replaceSection(
    source,
    '<section class="card"><div class="tag">Stage 06 · Website & Contact Discovery',
    '<section class="card"><div class="tag">Stage 06 → 07 Gate</div><h2>Qualified outreach-ready contractors</h2><p class="section-note">Only QUALIFIED contractors with a verified public email and source are eligible here. The list defaults to highest Contract Qualification score first and all eligible businesses selected. Use Clear All to choose recipients one by one. Existing TEST MODE remains authoritative.</p><div id="contacts"><div class="muted">Complete Stage 06 Contractor Qualification to populate outreach-ready businesses.</div></div></section>',
    'outreach gate section'
  );

  const renderRanked = `function renderRanked(){
    const base=(evidence.ranked_candidates&&evidence.ranked_candidates.length)?evidence.ranked_candidates:(evidence.candidates||[]);
    if(!base.length){$('ranked').innerHTML='<div class="muted">No contractor candidates yet.</div>';return}
    const num=v=>Number.isFinite(Number(v))?Number(v):null;
    const hasQualification=base.some(c=>num(c.contract_qualification_score??c.qualification_score)!==null);
    const rows=[...base].sort((a,b)=>hasQualification?((num(b.contract_qualification_score??b.qualification_score)??-1)-(num(a.contract_qualification_score??a.qualification_score)??-1)):((num(a.discovery_rank??a.rank)??9999)-(num(b.discovery_rank??b.rank)??9999)));
    let html='<table><thead><tr><th>Rank</th><th>Business</th><th>Discovery Match</th><th>Contract Qualification</th><th>Status</th><th>Research</th><th>Evidence</th></tr></thead><tbody>';
    rows.forEach((c,i)=>{const discovery=num(c.discovery_match_score);const qualification=num(c.contract_qualification_score??c.qualification_score);const coverage=num(c.evidence_coverage_percentage);const rank=c.qualification_rank??c.rank??c.discovery_rank??(i+1);const status=c.qualification_status||'PENDING';const research=c.research_status||'NOT_STARTED';html+='<tr><td>'+esc(rank)+'</td><td><b>'+esc(c.business_name||c.businessName||'')+'</b><br>'+esc(c.city||'')+(c.state?', '+esc(c.state):'')+'</td><td><b>'+(discovery===null?'—':esc(discovery)+'/100')+'</b><br><small>'+esc(c.discovery_match_status||'Discovery evidence')+'</small></td><td><b>'+(qualification===null?'Not scored':esc(qualification)+'/100')+'</b><br><small>'+(coverage===null?'Evidence coverage pending':esc(coverage)+'% evidence coverage')+'</small></td><td><span class="pill '+esc(status)+'">'+esc(status)+'</span></td><td><span class="pill '+esc(research)+'">'+esc(research)+'</span></td><td><details><summary>Why ranked</summary>'+(c.explanation?.why_ranked||[]).map(x=>'<div>• '+esc(x)+'</div>').join('')+'</details></td></tr>'});
    html+='</tbody></table>';$('ranked').innerHTML=html;
  }
`;
  source = replaceRange(source, 'function renderRanked(){', 'function renderContacts(){', renderRanked, 'renderRanked');

  const renderContacts = `function renderContacts(){
    const score=c=>Number(c.contract_qualification_score??c.qualification_score??-1);
    const rows=(evidence.contacts||[]).filter(c=>c.qualification_status==='QUALIFIED'&&c.contact_verified===true&&c.contact_email&&(c.contact_source_url||c.source_url)).sort((a,b)=>score(b)-score(a));
    if(!rows.length){$('contacts').innerHTML='<div class="muted">No qualified outreach-ready contractors yet. Complete Stage 06 qualification or review the qualification results.</div>';return}
    let html='<div class="row" style="margin-bottom:10px"><button id="selectAllOutreach" type="button" class="btn secondary">Select All</button><button id="clearAllOutreach" type="button" class="btn secondary">Clear All</button><div class="muted" style="align-self:center">'+rows.length+' qualified contractor(s) with verified public email · highest score first</div></div>';
    html+='<table><thead><tr><th>Send</th><th>Qualification Score</th><th>Business</th><th>Email</th><th>Website</th><th>Evidence</th></tr></thead><tbody>';
    rows.forEach((c,i)=>{html+='<tr><td><input type="checkbox" data-outreach-select="'+i+'" '+(c.outreach_approved?'checked':'')+'></td><td><b>'+esc(score(c))+'/100</b><br><small>Rank '+esc(c.qualification_rank??c.rank??'—')+'</small></td><td><b>'+esc(c.business_name||c.businessName||'')+'</b><br><small>'+esc(c.uei||c.ueiSAM||'')+'</small></td><td>'+esc(c.contact_email)+'</td><td>'+(c.official_website_url?'<a href="'+esc(c.official_website_url)+'" target="_blank" rel="noopener" style="color:#fff">Official website</a>':'—')+'</td><td><a href="'+esc(c.contact_source_url||c.source_url)+'" target="_blank" rel="noopener" style="color:#fff">Email source</a></td></tr>'});
    html+='</tbody></table>';$('contacts').innerHTML=html;
    document.querySelectorAll('[data-outreach-select]').forEach(el=>el.onchange=()=>{const row=rows[Number(el.dataset.outreachSelect)];const original=(evidence.contacts||[]).find(c=>c.candidate_id===row.candidate_id)||row;original.outreach_approved=el.checked;saveEvidence()});
    const all=$('selectAllOutreach'),clear=$('clearAllOutreach');if(all)all.onclick=()=>{(evidence.contacts||[]).forEach(c=>{if(c.qualification_status==='QUALIFIED'&&c.contact_verified)c.outreach_approved=true});saveEvidence();render()};if(clear)clear.onclick=()=>{(evidence.contacts||[]).forEach(c=>c.outreach_approved=false);saveEvidence();render()};
  }
`;
  source = replaceRange(source, 'function renderContacts(){', 'function renderOutreach(){', renderContacts, 'renderContacts');

  const workerMonitor = `function renderStage06Agents(state){
    const host=$('stageOutput');if(!host)return;
    const agents=Array.isArray(state?.agents)?state.agents:[];const candidates=Array.isArray(state?.candidates)?state.candidates:[];const byId=new Map(candidates.map(c=>[c.candidate_id,c]));const queue=state?.research_queue_summary||{};
    const slots=[1,2,3,4,5].map(slot=>{const a=agents.find(row=>Number(row.agent_slot)===slot);if(!a)return{slot,status:'NOT ASSIGNED',progress:0,business:'—',activity:'No worker required for this queue.',completed:0,assigned:0,verified:0};const c=byId.get(a.candidate_id)||{};const r=a.result_summary||{};return{slot,status:a.status||'READY',progress:Math.max(0,Math.min(100,Number(a.progress_percentage||0))),business:c.business_name||c.businessName||'Assigned contractor',activity:a.current_activity||'',completed:Number(r.completed_count||0),assigned:Number(r.assigned_count||0),verified:Number(r.verified_count||0)}});
    const stagePct=Math.max(0,Math.min(100,Number(state?.stage_progress_percentage??state?.agent_summary?.progress_percentage??0)));
    let html='<div class="tag">Stage 05 Research Worker Monitor</div><h3>Contractor Research & Contact Discovery</h3><p class="muted">All SAM contractor candidates are queued automatically. Five workers process the full queue concurrently; completing one contractor moves that worker to its next assignment.</p><div class="progress"><i style="width:'+stagePct+'%"></i></div><p><b>Overall '+stagePct+'%</b> · '+esc(queue.completed||0)+' / '+esc(queue.total||0)+' contractor candidates researched · '+esc(queue.verified||0)+' verified public email(s)</p>';
    slots.forEach(a=>{html+='<div style="padding:10px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:12px"><b>Worker '+String(a.slot).padStart(2,'0')+' · '+esc(a.business)+'</b><span class="pill '+esc(a.status)+'">'+esc(a.status)+' · '+a.progress+'%</span></div><div class="progress"><i style="width:'+a.progress+'%"></i></div><small>'+esc(a.activity)+'</small><div class="muted" style="margin-top:3px">Assignments '+esc(a.completed)+'/'+esc(a.assigned)+' · verified emails '+esc(a.verified)+'</div></div>'});
    host.innerHTML=html;
  }
`;
  source = replaceRange(source, 'function renderStage06Agents(state){', 'function mergeStage06State(state){', workerMonitor, 'research worker monitor');

  const executeResearch = `async function executePersistentContactDiscovery(){
    if(!evidence.search_run_id)throw new Error('Stage 05 requires the persisted Stage 04 contractor search run.');
    const setup=await req('/.netlify/functions/ngcc-ops-contact-discovery',{method:'POST',body:JSON.stringify({mission_id:ctx.mission.id,search_run_id:evidence.search_run_id||'',contract_dna:evidence.contract_dna,business_search_dna:evidence.business_search_dna})});
    mergeStage06State(setup);await req('/.netlify/functions/ngcc-ops-contact-discovery-background',{method:'POST',body:JSON.stringify(setup.background_payload)});return pollPersistentContactDiscovery({mission_id:ctx.mission.id,search_run_id:setup.search_run_id,attempt_number:setup.attempt_number})
  }
`;
  source = replaceRange(source, 'async function executePersistentContactDiscovery(){', 'async function resumePersistentContactDiscovery(){', executeResearch, 'executePersistentContactDiscovery');

  const oldQualification = "if(step.step_code==='CONTRACTOR_QUALIFICATION'){evidence.search_run_id=result.search_run_id||evidence.search_run_id;evidence.ranked_candidates=(result.ranked_candidates||[]).map(c=>({...c,operator_selected:false}))}";
  const newQualification = "if(step.step_code==='CONTRACTOR_QUALIFICATION'){evidence.search_run_id=result.search_run_id||evidence.search_run_id;evidence.ranked_candidates=(result.ranked_candidates||[]).map(c=>({...c,operator_selected:false}));const qscore=c=>Number(c.contract_qualification_score??c.qualification_score??-1);evidence.contacts=evidence.ranked_candidates.filter(c=>c.qualification_status==='QUALIFIED'&&c.contact_verified===true&&c.contact_email&&(c.contact_source_url||c.source_url)).sort((a,b)=>qscore(b)-qscore(a)).map(c=>({...c,outreach_approved:true}))}";
  if (!source.includes(oldQualification)) throw new Error('[ngcc-research-routing] qualification evidence marker was not found.');
  source = source.replace(oldQualification, newQualification);

  source = source.replace('Website & Contact Discovery completed. All assigned agents reached 100%.', 'Contractor Research & Contact Discovery completed. The full contractor queue was processed.');
  source = source.replace('Stage 06 completed but requires operator retry.', 'Contractor research completed but requires operator retry.');

  fs.writeFileSync(target, source, 'utf8');
  console.log('[ngcc-research-routing] v3 now uses full-queue five-worker research and score-sorted outreach selection.');
}

function patchV5() {
  const target = path.join(process.cwd(), 'ops-command-center-v5.html');
  let source = fs.readFileSync(target, 'utf8');
  const start = source.indexOf('    // Stage 05 v2: distinguish why a business was discovered');
  if (start >= 0) {
    const endMarker = '    html=html.slice(0,qualificationUiStart)+qualificationUiFunction+html.slice(qualificationUiEnd);\n\n';
    const end = source.indexOf(endMarker, start);
    if (end < 0) throw new Error('[ngcc-research-routing] v5 legacy qualification UI block end marker was not found.');
    source = source.slice(0, start) + source.slice(end + endMarker.length);
  }
  fs.writeFileSync(target, source, 'utf8');
  console.log('[ngcc-research-routing] v5 legacy five-selection runtime override removed.');
}

patchV3();
patchV5();
