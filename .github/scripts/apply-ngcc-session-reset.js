'use strict';
const fs = require('fs');
const path = 'ops-command-center-v5.html';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!s.includes(from)) throw new Error(`Missing patch marker: ${label}`);
  s = s.replace(from, to);
}

// 1. Login/session behavior. Do not auto-open the most recent historical mission.
// Resume only the mission explicitly selected in this browser session.
replaceOnce(
  "    html = html.replace(originalSave, patchedSave).replace(originalLoad, patchedLoad);\n",
  "    html = html.replace(originalSave, patchedSave).replace(originalLoad, patchedLoad);\n\n" +
  "    // Session behavior: a login opens a clean Task Execution workspace by default.\n" +
  "    // Only a mission selected in the current browser session is resumed on refresh.\n" +
  "    const originalLoadMissions = \"async function loadMissions(){const d=await req('/.netlify/functions/ngcc-ops-mission-control');if(d.missions?.length)await openMission(d.missions[0].id);else render()}\";\n" +
  "    const patchedLoadMissions = `async function loadMissions(){const resumeId=sessionStorage.getItem('ngcc_active_mission_id');if(resumeId){try{await openMission(resumeId);return}catch(error){console.warn('[ngcc-session-resume]',error);sessionStorage.removeItem('ngcc_active_mission_id')}}ctx=null;evidence={};render()}`;\n" +
  "    if (!html.includes(originalLoadMissions)) throw new Error('Mission session patch marker was not found.');\n" +
  "    html = html.replace(originalLoadMissions, patchedLoadMissions);\n",
  'session-aware loadMissions'
);

// 2. Store the mission selected in this session so a refresh can resume it.
replaceOnce(
  "ctx=await req('/.netlify/functions/ngcc-ops-mission-control',{method:'POST',body:JSON.stringify({action:'create',opportunity:opp})});evidence={opportunity:opp,contract_state:contractState,contractor_state:contractorState,ranked_candidates:[],contacts:[],outreach_result:null,reconciliation:null,closeout:null};saveEvidence();render();",
  "ctx=await req('/.netlify/functions/ngcc-ops-mission-control',{method:'POST',body:JSON.stringify({action:'create',opportunity:opp})});if(ctx?.mission?.id)sessionStorage.setItem('ngcc_active_mission_id',ctx.mission.id);evidence={opportunity:opp,contract_state:contractState,contractor_state:contractorState,ranked_candidates:[],contacts:[],outreach_result:null,reconciliation:null,closeout:null};saveEvidence();render();",
  'createMission resume pointer'
);

// 3. The drawer had a local `render` constant that shadowed the Mission Control
// render() function. That is why Start New Task changed the message but left the
// old mission DOM visible. Rename the drawer renderer.
replaceOnce('      const render=()=>', '      const renderDrawer=()=>', 'drawer render declaration');
replaceOnce(
  "summary.textContent=drawerResults.length+' contract'+(drawerResults.length===1?'':'s')+' loaded'+(bits.length?' · '+bits.join(' · '):'');render();const reopen=",
  "summary.textContent=drawerResults.length+' contract'+(drawerResults.length===1?'':'s')+' loaded'+(bits.length?' · '+bits.join(' · '):'');renderDrawer();const reopen=",
  'drawer setResults render'
);
replaceOnce('filter.oninput=render;document.addEventListener', 'filter.oninput=renderDrawer;document.addEventListener', 'drawer filter render');

// 4. Hide Browse Contracts when the current search result set is empty.
replaceOnce(
  '      .ngcc-control-panel #opps{display:none!important}\n',
  '      .ngcc-control-panel #opps{display:none!important}\n      #openNgccContractDrawer[hidden]{display:none!important}\n',
  'drawer hidden CSS'
);
replaceOnce(
  "if(reopen){reopen.hidden=!drawerResults.length;reopen.textContent='Browse '+drawerResults.length+' Contract'+(drawerResults.length===1?'':'s')}",
  "if(reopen){reopen.hidden=!drawerResults.length;reopen.style.display=drawerResults.length?'':'none';reopen.textContent='Browse '+drawerResults.length+' Contract'+(drawerResults.length===1?'':'s')}",
  'drawer reopen visibility'
);
replaceOnce(
  "reopen.hidden=true;reopen.textContent='Browse Contracts';reopen.onclick=open;stageOne.appendChild(reopen);",
  "reopen.hidden=true;reopen.style.display='none';reopen.textContent='Browse Contracts';reopen.onclick=open;stageOne.appendChild(reopen);",
  'drawer initial visibility'
);

// 5. Start New Task clears the browser-session resume pointer, local workspace,
// and then calls the actual Mission Control render() function (no longer shadowed).
replaceOnce(
  "btn.onclick=()=>{const prior=ctx?.mission?.mission_number||ctx?.mission?.id||null;ctx=null;evidence={};",
  "btn.onclick=()=>{const prior=ctx?.mission?.mission_number||ctx?.mission?.id||null;sessionStorage.removeItem('ngcc_active_mission_id');ctx=null;evidence={};",
  'Start New Task reset'
);

// Parse-check the outer script before writing it back.
const begin = s.indexOf('<script>') + '<script>'.length;
const end = s.lastIndexOf('</script>');
if (begin < '<script>'.length || end < begin) throw new Error('Unable to locate outer script for syntax validation.');
new Function(s.slice(begin, end));

fs.writeFileSync(path, s, 'utf8');
console.log('NGCC session-reset patch applied and syntax-validated.');
