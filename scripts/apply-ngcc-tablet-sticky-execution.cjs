const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'ops-command-center-v5.html');
let source = fs.readFileSync(target, 'utf8');

const alreadyApplied = "executionDock.className='ngcc-execution-dock'";
if (source.includes(alreadyApplied)) {
  console.log('[ngcc-tablet-sticky] patch already present; no changes needed.');
  process.exit(0);
}

function replaceRequired(needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`[ngcc-tablet-sticky] required marker not found: ${label}`);
  }
  source = source.replace(needle, replacement);
}

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

fs.writeFileSync(target, source, 'utf8');
console.log('[ngcc-tablet-sticky] execution card moved above the mission panels and made sticky for tablet/desktop viewports.');
