const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'ops-command-center-v5.html');
let source = fs.readFileSync(target, 'utf8');

function replaceRequired(needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`[ngcc-tablet-sticky] required marker not found: ${label}`);
  }
  source = source.replace(needle, replacement);
}

const stickyMarker = "executionDock.className='ngcc-execution-dock'";
if (!source.includes(stickyMarker)) {
  replaceRequired(
    "      .ngcc-monitor-panel{min-width:0}\n",
    `      .ngcc-monitor-panel{min-width:0}\n      .ngcc-execution-dock{position:-webkit-sticky;position:sticky;top:54px;z-index:99960;margin:0 0 14px}\n      .ngcc-execution-dock>section.card{margin:0;background:linear-gradient(135deg,rgba(15,42,106,.96),rgba(7,26,60,.96));border-color:rgba(213,174,85,.45);box-shadow:0 12px 30px rgba(0,0,0,.28);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}\n      .ngcc-execution-dock #execute{width:100%;min-width:0}\n      @media(min-width:701px){\n        .ngcc-execution-dock>section.card{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,230px) minmax(180px,220px);grid-template-rows:auto auto auto auto;column-gap:14px;row-gap:3px;align-items:center;padding:12px 16px}\n        .ngcc-execution-dock #execTag{grid-column:1;grid-row:1}\n        .ngcc-execution-dock #execTitle{grid-column:1;grid-row:2;margin:.1rem 0 .15rem;font-size:20px}\n        .ngcc-execution-dock #execDesc{grid-column:1;grid-row:3;margin:0;font-size:11px}\n        .ngcc-execution-dock label{grid-column:2;grid-row:1;margin:0}\n        .ngcc-execution-dock #contractorState{grid-column:2;grid-row:2}\n        .ngcc-execution-dock small.muted{grid-column:2;grid-row:3;margin:0!important}\n        .ngcc-execution-dock #execute{grid-column:3;grid-row:2;align-self:stretch}\n        .ngcc-execution-dock #execMsg{grid-column:1/-1;grid-row:4;margin-top:4px}\n      }\n      @media(max-width:700px){\n        .ngcc-execution-dock{top:52px}\n        .ngcc-execution-dock>section.card{max-height:calc(100vh - 64px);overflow:auto;padding:14px}\n      }\n      @media(max-width:620px){.ngcc-execution-dock{position:static}}\n`,
    'execution dock CSS insertion point'
  );

  replaceRequired(
    "      .ngcc-control-panel #searchOpps,.ngcc-control-panel #execute,#openNgccContractDrawer{width:100%;min-width:0}\n",
    "      .ngcc-control-panel #searchOpps,#openNgccContractDrawer{width:100%;min-width:0}\n",
    'left-panel execution width selector'
  );

  replaceRequired(
    "        const leftHeading=document.createElement('div');leftHeading.className='ngcc-panel-heading';leftHeading.innerHTML='<div class=\"tag\">Task Execution</div><h2>Mission Controls</h2><p class=\"muted\">Define the SAM.gov scope and execute the server-authorized next stage.</p>';\n",
    "        const leftHeading=document.createElement('div');leftHeading.className='ngcc-panel-heading';leftHeading.innerHTML='<div class=\"tag\">Mission Setup</div><h2>Mission Controls</h2><p class=\"muted\">Define the SAM.gov scope and select one federal contract.</p>';\n",
    'Mission Controls heading'
  );

  replaceRequired(
    "        left.append(leftHeading,actions,stageOne,execution);\n        right.append(rightHeading,sidebar,metrics);\n        grid.append(left,right);\n        app.insertBefore(grid,originalLayout);\n        workspace.classList.add('ngcc-results-workspace');\n        grid.after(workspace);\n",
    "        const executionDock=document.createElement('div');executionDock.className='ngcc-execution-dock';executionDock.setAttribute('aria-label','Current stage execution');executionDock.appendChild(execution);\n        left.append(leftHeading,actions,stageOne);\n        right.append(rightHeading,sidebar,metrics);\n        grid.append(left,right);\n        app.insertBefore(executionDock,originalLayout);\n        app.insertBefore(grid,originalLayout);\n        workspace.classList.add('ngcc-results-workspace');\n        grid.after(workspace);\n",
    'operator layout execution placement'
  );

  console.log('[ngcc-tablet-sticky] execution card moved above the mission panels and made sticky for tablet/desktop viewports.');
} else {
  console.log('[ngcc-tablet-sticky] sticky execution patch already present.');
}

const fullFilterMarker = 'id="opportunityType"';
if (!source.includes(fullFilterMarker)) {
  const currentControls = '<div><label>NAICS</label><input id="naics" placeholder="optional"></div><div><label>Contract State</label><select id="contractState"><option value="">All States</option></select></div><div style="flex:0">';
  const fullControls = '<div><label>NAICS</label><input id="naics" placeholder="optional"></div><div><label>Contract State</label><select id="contractState"><option value="">All States</option></select></div><div><label>Set-Aside</label><select id="setAside"><option value="">All Set-Asides</option><option value="SBA">Total Small Business (SBA)</option><option value="SBP">Partial Small Business (SBP)</option><option value="8A">8(a) Set-Aside (8A)</option><option value="8AN">8(a) Sole Source (8AN)</option><option value="HZC">HUBZone Set-Aside (HZC)</option><option value="HZS">HUBZone Sole Source (HZS)</option><option value="SDVOSBC">SDVOSB Set-Aside (SDVOSBC)</option><option value="SDVOSBS">SDVOSB Sole Source (SDVOSBS)</option><option value="WOSB">WOSB Set-Aside (WOSB)</option><option value="WOSBSS">WOSB Sole Source (WOSBSS)</option><option value="EDWOSB">EDWOSB Set-Aside (EDWOSB)</option><option value="EDWOSBSS">EDWOSB Sole Source (EDWOSBSS)</option><option value="LAS">Local Area Set-Aside (LAS)</option><option value="IEE">Indian Economic Enterprise (IEE)</option><option value="ISBEE">Indian Small Business Economic Enterprise (ISBEE)</option><option value="BICiv">Buy Indian Set-Aside (BICiv)</option><option value="VSA">Veteran-Owned Small Business Set-Aside (VSA)</option><option value="VSS">Veteran-Owned Small Business Sole Source (VSS)</option></select></div><div><label>Notice Type</label><select id="opportunityType"><option value="">All Notice Types</option><option value="o">Solicitation</option><option value="p">Pre-Solicitation</option><option value="k">Combined Synopsis/Solicitation</option><option value="r">Sources Sought</option><option value="s">Special Notice</option><option value="a">Award Notice</option><option value="u">Justification (J&amp;A)</option><option value="g">Sale of Surplus Property</option><option value="i">Intent to Bundle Requirements</option></select></div><div><label>Posted From</label><input id="postedFrom" type="date"></div><div><label>Posted To</label><input id="postedTo" type="date"></div><div style="flex:0">';
  replaceRequired(currentControls, fullControls, 'Stage 01 full SAM filter controls');

  const currentQuery = "if($('contractState')?.value)p.set('state',$('contractState').value);$('searchOpps').disabled=true;";
  const fullQuery = "if($('contractState')?.value)p.set('state',$('contractState').value);if($('setAside')?.value)p.set('set_aside',$('setAside').value);if($('opportunityType')?.value)p.set('ptype',$('opportunityType').value);if($('postedFrom')?.value)p.set('postedFrom',$('postedFrom').value);if($('postedTo')?.value)p.set('postedTo',$('postedTo').value);$('searchOpps').disabled=true;";
  replaceRequired(currentQuery, fullQuery, 'Stage 01 full SAM query mapping');

  const resetNeedle = "['keyword','naics','contractState','contractorState']";
  if (source.includes(resetNeedle)) {
    source = source.replace(
      resetNeedle,
      "['keyword','naics','contractState','setAside','opportunityType','postedFrom','postedTo','contractorState']"
    );
  }

  console.log('[ngcc-stage01-sam-filters] added set-aside, notice type, and posted-date controls to Stage 01.');
} else {
  console.log('[ngcc-stage01-sam-filters] full Stage 01 SAM filters already present.');
}

const samStatusMarker = 'Contract queue drawer populated.';
if (!source.includes(samStatusMarker)) {
  replaceRequired(
    "const results=d.results||[];window.ngccContractDrawer?.setResults(results,",
    "const results=Array.isArray(d.results)?d.results:[];const activeCount=Number.isFinite(Number(d.active_count))?Number(d.active_count):results.length;window.ngccContractDrawer?.setResults(results,",
    'Stage 01 SAM result normalization'
  );

  replaceRequired(
    "$('oppsMsg').textContent=results.length+' active SAM.gov opportunities returned'+(d.state?' for '+d.state:'')+'. Select a contract from the drawer.';if(results.length)window.ngccContractDrawer?.open();else window.ngccContractDrawer?.close();",
    "if(d.search_status==='PARTIAL_SUCCESS'){$('oppsMsg').className=results.length?'msg ok':'msg';$('oppsMsg').textContent=activeCount+' active SAM.gov opportunities loaded'+(d.state?' for '+d.state:'')+'. '+Number(d.failed_paths||0)+' SAM.gov search path'+(Number(d.failed_paths||0)===1?'':'s')+' failed; results may be incomplete.';}else if(d.search_status==='SUCCESS_EMPTY'||activeCount===0){$('oppsMsg').className='msg ok';$('oppsMsg').textContent='0 active SAM.gov opportunities loaded'+(d.state?' for '+d.state:'')+' — no records matched the current filter combination.';}else{$('oppsMsg').className='msg ok';$('oppsMsg').textContent=activeCount+' active SAM.gov opportunities loaded'+(d.state?' for '+d.state:'')+'. Contract queue drawer populated.';}if(results.length)window.ngccContractDrawer?.open();else window.ngccContractDrawer?.close();",
    'Stage 01 SAM status indicator'
  );

  replaceRequired(
    "const d=await req('/.netlify/functions/ngcc-ops-sam-opportunities?'+p);setResults(d.results||[],{state:d.state||drawerScope.state,title:d.title||drawerScope.title,naics:(d.naicsCodes||[]).join(', ')||drawerScope.naics},{page:d.page||page,has_previous:Boolean(d.has_previous),has_next:Boolean(d.has_next),total_records:d.total_records??null});const oppsMsg=document.getElementById('oppsMsg');if(oppsMsg){oppsMsg.className='msg';oppsMsg.textContent='SAM.gov contract batch '+drawerPage+' loaded — '+drawerResults.length+' contract'+(drawerResults.length===1?'':'s')+' available.'}",
    "const d=await req('/.netlify/functions/ngcc-ops-sam-opportunities?'+p);const pageResults=Array.isArray(d.results)?d.results:[];const activeCount=Number.isFinite(Number(d.active_count))?Number(d.active_count):pageResults.length;setResults(pageResults,{state:d.state||drawerScope.state,title:d.title||drawerScope.title,naics:(d.naicsCodes||[]).join(', ')||drawerScope.naics},{page:d.page||page,has_previous:Boolean(d.has_previous),has_next:Boolean(d.has_next),total_records:d.total_records??null});const oppsMsg=document.getElementById('oppsMsg');if(oppsMsg){oppsMsg.className=d.search_status==='SUCCESS_EMPTY'?'msg ok':'msg';oppsMsg.textContent=d.search_status==='SUCCESS_EMPTY'?'0 active SAM.gov opportunities loaded — no records matched this page of the current filter combination.':'SAM.gov contract batch '+drawerPage+' loaded — '+activeCount+' active opportunit'+(activeCount===1?'y':'ies')+' available.'}",
    'contract drawer page status indicator'
  );

  console.log('[ngcc-stage01-sam-status] added explicit empty/success/partial SAM.gov result messaging and active-count drawer status.');
} else {
  console.log('[ngcc-stage01-sam-status] explicit SAM.gov result status messaging already present.');
}

fs.writeFileSync(target, source, 'utf8');
