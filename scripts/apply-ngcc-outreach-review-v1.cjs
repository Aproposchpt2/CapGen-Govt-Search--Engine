const fs = require('fs');
const path = require('path');

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start >= 0 ? start + startMarker.length : 0);
  if (start < 0 || end < 0) throw new Error(`[ngcc-outreach-review] ${label} markers were not found.`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceSection(source, startMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`[ngcc-outreach-review] ${label} start marker was not found.`);
  const end = source.indexOf('</section>', start);
  if (end < 0) throw new Error(`[ngcc-outreach-review] ${label} closing section was not found.`);
  return source.slice(0, start) + replacement + source.slice(end + '</section>'.length);
}

const target = path.join(process.cwd(), 'ops-command-center-v3.html');
let source = fs.readFileSync(target, 'utf8');

source = source.replace(
  'Existing TEST MODE remains authoritative.',
  'No email is sent until Stage 07 draft review and explicit operator approval.'
);

source = replaceSection(
  source,
  '<section class="card"><div class="tag">Stage 07 · Business Outreach',
  '<section class="card"><div class="tag">Stage 07 · Business Outreach</div><h2>Opportunity email drafts — review, edit, save, then send</h2><p class="section-note">Stage 07 prepares a separate draft for every selected outreach-ready contractor. Draft preparation sends nothing. Review one business at a time, edit the subject or message, save the draft, then explicitly approve and send. The prospective client receives the opportunity email and NGCC separately emails the operator a send confirmation.</p><div id="outreach"><div class="muted">No Stage 07 drafts yet. Select recipients above, then execute Stage 07 to prepare drafts.</div></div></section>',
  'Stage 07 outreach editor section'
);

const outreachUi = `function outreachDraftRows(){
  const rows=Array.isArray(evidence.outreach_drafts)?evidence.outreach_drafts:[];
  const score=row=>Number(row?.provider_payload?.qualification_score??-1);
  return [...rows].sort((a,b)=>score(b)-score(a));
}
function activeOutreachDraft(){
  const rows=outreachDraftRows();if(!rows.length)return null;
  const id=evidence.active_outreach_id||'';
  return rows.find(row=>row.outreach_id===id)||rows[0];
}
function setActiveOutreachDraft(id){evidence.active_outreach_id=id||null;saveEvidence();renderOutreach()}
function replaceOutreachDraft(updated){
  if(!updated)return;
  const rows=Array.isArray(evidence.outreach_drafts)?evidence.outreach_drafts:[];
  const index=rows.findIndex(row=>row.outreach_id===updated.outreach_id);
  if(index>=0)rows[index]=updated;else rows.push(updated);
  evidence.outreach_drafts=rows;evidence.active_outreach_id=updated.outreach_id;saveEvidence();
}
async function refreshOutreachDrafts(){
  const noticeId=normalizedContract().noticeId;if(!noticeId)return;
  const result=await req('/.netlify/functions/ngcc-ops-outreach?notice_id='+encodeURIComponent(noticeId));
  evidence.outreach_drafts=Array.isArray(result.outreach)?result.outreach:[];
  if(!evidence.active_outreach_id&&evidence.outreach_drafts.length)evidence.active_outreach_id=evidence.outreach_drafts[0].outreach_id;
  saveEvidence();renderOutreach();
}
async function saveActiveOutreachDraft(silent){
  const draft=activeOutreachDraft();if(!draft)throw new Error('No outreach draft is selected.');
  const subject=$('ngccOutreachSubject')?.value||draft.subject||'';
  const bodyText=$('ngccOutreachBody')?.value||draft.body_text||'';
  const result=await req('/.netlify/functions/ngcc-ops-outreach',{method:'POST',body:JSON.stringify({action:'save',outreach_id:draft.outreach_id,subject:subject,body_text:bodyText})});
  replaceOutreachDraft(result.outreach);renderOutreach();
  if(!silent){$('execMsg').className='msg ok';$('execMsg').textContent='Outreach draft saved.'}
  return result.outreach;
}
async function sendActiveOutreachDraft(){
  let draft=activeOutreachDraft();if(!draft)return;
  if(String(draft.status||'').toLowerCase()==='sent')return;
  if(!confirm('Send the approved opportunity email to '+(draft.business_name||draft.contact_email)+'?'))return;
  try{
    $('ngccSendOutreach').disabled=true;$('ngccSaveOutreach').disabled=true;
    draft=await saveActiveOutreachDraft(true);
    $('execMsg').className='msg';$('execMsg').textContent='Sending approved opportunity email…';
    const result=await req('/.netlify/functions/ngcc-ops-outreach',{method:'POST',body:JSON.stringify({action:'send',outreach_id:draft.outreach_id})});
    replaceOutreachDraft(result.outreach);
    const rows=outreachDraftRows();const sent=rows.filter(row=>String(row.status||'').toLowerCase()==='sent').length;const pending=rows.length-sent;
    const progress=pending?Math.min(95,60+Math.round((sent/Math.max(1,rows.length))*35)):100;
    evidence.outreach_result={summary:{total:rows.length,SENT:sent,PENDING:pending},last_send:result};saveEvidence();
    if(pending){
      await transition('BUSINESS_OUTREACH','WAITING',{progress_percentage:progress,current_activity:sent+' sent · '+pending+' prepared email'+(pending===1?'':'s')+' remain',output_summary:evidence.outreach_result.summary,evidence:[{type:'NGCC_OUTREACH_SEND',source:'ngcc_outreach_events'}]});
    }else{
      await transition('BUSINESS_OUTREACH','SUCCESS',{progress_percentage:100,current_activity:'All approved opportunity emails sent',records_examined:rows.length,records_accepted:sent,records_rejected:0,output_summary:evidence.outreach_result.summary,evidence:[{type:'NGCC_OUTREACH_SEND',source:'ngcc_outreach_events'}]});
    }
    if(result.operator_notification_sent){$('execMsg').className='msg ok';$('execMsg').textContent='Prospective client emailed. Operator notification emailed.'}
    else{$('execMsg').className='msg warntext';$('execMsg').textContent='Prospective client emailed, but the operator notification needs retry: '+(result.operator_notification_error||'notification unavailable')}
    render();
  }catch(error){$('execMsg').className='msg err';$('execMsg').textContent=error.message;renderOutreach()}
}
async function retryOutreachNotification(){
  const draft=activeOutreachDraft();if(!draft||String(draft.status||'').toLowerCase()!=='sent')return;
  try{
    const result=await req('/.netlify/functions/ngcc-ops-outreach',{method:'POST',body:JSON.stringify({action:'notify',outreach_id:draft.outreach_id})});
    replaceOutreachDraft(result.outreach);$('execMsg').className=result.operator_notification_sent?'msg ok':'msg warntext';$('execMsg').textContent=result.operator_notification_sent?'Operator notification emailed.':'Operator notification retry failed: '+(result.operator_notification_error||'unknown error');renderOutreach();
  }catch(error){$('execMsg').className='msg err';$('execMsg').textContent=error.message}
}
function renderOutreach(){
  const rows=outreachDraftRows();
  if(!rows.length){$('outreach').innerHTML='<div class="muted">No Stage 07 drafts yet. Select recipients above, then execute Stage 07 to prepare drafts.</div>';return}
  let draft=activeOutreachDraft();if(!draft){draft=rows[0];evidence.active_outreach_id=draft.outreach_id;saveEvidence()}
  const index=Math.max(0,rows.findIndex(row=>row.outreach_id===draft.outreach_id));
  const status=String(draft.status||'draft').toLowerCase();const sent=status==='sent';const canceled=status==='canceled';
  const notification=String(draft.provider_payload?.operator_notification_status||'PENDING').toUpperCase();
  const score=draft.provider_payload?.qualification_score;
  let html='<div class="controls">';
  html+='<button id="ngccPrevOutreach" type="button" class="btn secondary" '+(index<=0?'disabled':'')+'>← Previous Email</button>';
  html+='<span class="pill WAITING" style="align-self:center">Email '+(index+1)+' of '+rows.length+'</span>';
  html+='<button id="ngccNextOutreach" type="button" class="btn secondary" '+(index>=rows.length-1?'disabled':'')+'>Next Email →</button>';
  html+='<button id="ngccRefreshOutreach" type="button" class="btn secondary">Refresh Drafts</button></div>';
  html+='<div class="handoff-grid" style="margin:10px 0"><div class="handoff"><small>BUSINESS</small><br><b>'+esc(draft.business_name||'Unavailable')+'</b></div><div class="handoff"><small>RECIPIENT</small><br><b>'+esc(draft.contact_email||'Unavailable')+'</b></div><div class="handoff"><small>STATUS</small><br><span class="pill '+esc(status.toUpperCase())+'">'+esc(status.toUpperCase())+'</span>'+(score!==null&&score!==undefined?'<br><small>Qualification '+esc(score)+'/100</small>':'')+'</div></div>';
  html+='<label>Subject<input id="ngccOutreachSubject" type="text" value="'+esc(draft.subject||'')+'" '+(sent||canceled?'disabled':'')+'></label>';
  html+='<label>Email message<textarea id="ngccOutreachBody" rows="16" '+(sent||canceled?'disabled':'')+'>'+esc(draft.body_text||'')+'</textarea></label>';
  html+='<div class="controls"><button id="ngccSaveOutreach" type="button" class="btn secondary" '+(sent||canceled?'disabled':'')+'>Save Draft</button><button id="ngccSendOutreach" type="button" class="btn warn" '+(sent||canceled?'disabled':'')+'>Approve and Send This Business</button>';
  if(sent&&notification!=='SENT')html+='<button id="ngccRetryNotification" type="button" class="btn secondary">Retry Operator Notification</button>';
  html+='</div>';
  if(sent)html+='<p class="ok"><b>Prospective client sent.</b> Operator notification: '+esc(notification)+'</p>';
  else html+='<p class="muted">Draft preparation has not sent this email. Save changes, then use Approve and Send This Business.</p>';
  $('outreach').innerHTML=html;
  const previous=$('ngccPrevOutreach'),next=$('ngccNextOutreach');if(previous)previous.onclick=()=>setActiveOutreachDraft(rows[index-1]?.outreach_id);if(next)next.onclick=()=>setActiveOutreachDraft(rows[index+1]?.outreach_id);
  if($('ngccRefreshOutreach'))$('ngccRefreshOutreach').onclick=()=>refreshOutreachDrafts().catch(error=>{$('execMsg').className='msg err';$('execMsg').textContent=error.message});
  if($('ngccSaveOutreach'))$('ngccSaveOutreach').onclick=()=>saveActiveOutreachDraft(false).catch(error=>{$('execMsg').className='msg err';$('execMsg').textContent=error.message});
  if($('ngccSendOutreach'))$('ngccSendOutreach').onclick=sendActiveOutreachDraft;
  if($('ngccRetryNotification'))$('ngccRetryNotification').onclick=retryOutreachNotification;
}
`;
source = replaceRange(source, 'function renderOutreach(){', 'function renderResponse(){', outreachUi, 'renderOutreach');

const oldBusinessOutreachResult = "if(step.step_code==='BUSINESS_OUTREACH')evidence.outreach_result=result;saveEvidence();const terminal=result.status==='ZERO_RESULT'?'ZERO_RESULT':'SUCCESS';";
const newBusinessOutreachResult = "if(step.step_code==='BUSINESS_OUTREACH'){evidence.outreach_result=result;evidence.outreach_drafts=Array.isArray(result.drafts)?result.drafts:[];evidence.active_outreach_id=evidence.outreach_drafts[0]?.outreach_id||null;saveEvidence();const ready=evidence.outreach_drafts.filter(row=>String(row.status||'').toLowerCase()!=='sent').length;await transition(step.step_code,'WAITING',{progress_percentage:60,current_activity:ready+' outreach draft'+(ready===1?'':'s')+' ready — review, edit, save, then send',records_examined:result.summary?.total||0,records_accepted:ready,records_rejected:result.summary?.FAILED||0,output_summary:result.summary||{},evidence:[{type:'NGCC_OUTREACH_DRAFT_PREPARATION',source:'ngcc_outreach_events'}]});$('execMsg').className='msg ok';$('execMsg').textContent=ready+' outreach draft'+(ready===1?' is':'s are')+' ready. No email has been sent.';render();return}saveEvidence();const terminal=result.status==='ZERO_RESULT'?'ZERO_RESULT':'SUCCESS';";
if (!source.includes(oldBusinessOutreachResult)) throw new Error('[ngcc-outreach-review] BUSINESS_OUTREACH result marker was not found.');
source = source.replace(oldBusinessOutreachResult, newBusinessOutreachResult);

source = source.replace(
  "active?.step_code==='BUSINESS_OUTREACH'&&!approvedContacts().length?'Approve VERIFIED contacts below before Stage 07.'",
  "active?.step_code==='BUSINESS_OUTREACH'&&!approvedContacts().length?'Select outreach-ready contractors above before Stage 07 draft preparation.'"
);

fs.writeFileSync(target, source, 'utf8');
console.log('[ngcc-outreach-review] Stage 07 now uses draft → edit → save → explicit production send → operator notification.');
