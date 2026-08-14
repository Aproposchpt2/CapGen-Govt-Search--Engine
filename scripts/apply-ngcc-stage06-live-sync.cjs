const fs = require('fs');
const path = require('path');

function patchLiveStage06Sync() {
  const target = path.join(process.cwd(), 'ops-command-center-v3.html');
  let source = fs.readFileSync(target, 'utf8');

  if (source.includes('const ngccStage06LiveSync=true;')) {
    console.log('[ngcc-stage06-live-sync] already applied.');
    return;
  }

  const start = source.indexOf('function mergeStage06State(state){');
  const end = source.indexOf('\nasync function pollPersistentContactDiscovery', start);
  if (start < 0 || end < 0) {
    throw new Error('[ngcc-stage06-live-sync] Stage 06 persistent-state markers were not found.');
  }

  const replacement = `const ngccStage06LiveSync=true;
function mergeStage06State(state){
  if(state?.search_run_id)evidence.search_run_id=state.search_run_id;
  if(state?.attempt_number)evidence.stage06_attempt_number=state.attempt_number;
  if(Array.isArray(state?.candidates)&&state.candidates.length)evidence.ranked_candidates=state.candidates;
  const approved=new Set((evidence.contacts||[]).filter(c=>c.outreach_approved).map(c=>c.candidate_id||c.contact_email));
  if(Array.isArray(state?.contacts))evidence.contacts=state.contacts.map(c=>({...c,outreach_approved:approved.has(c.candidate_id||c.contact_email)}));
  const liveStep=ctx?.steps?.find(s=>s.step_code==='CONTACT_DISCOVERY');
  if(liveStep){
    liveStep.status=state?.status||liveStep.status;
    liveStep.derived_status=state?.status||liveStep.derived_status;
    liveStep.progress_percentage=Math.max(0,Math.min(100,Number(state?.stage_progress_percentage??state?.agent_summary?.progress_percentage??liveStep.progress_percentage??0)));
    liveStep.current_activity=state?.current_activity||liveStep.current_activity;
  }
  saveEvidence();
  render();
  renderStage06Agents(state);
}`;

  source = source.slice(0, start) + replacement + source.slice(end);
  fs.writeFileSync(target, source, 'utf8');
  console.log('[ngcc-stage06-live-sync] execution card, staging panel, and five-agent monitor now share live persisted Stage 06 progress.');
}

patchLiveStage06Sync();
