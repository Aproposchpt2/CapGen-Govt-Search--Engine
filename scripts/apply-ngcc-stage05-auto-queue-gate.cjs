'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'ops-command-center-v3.html');
let source = fs.readFileSync(target, 'utf8');

const oldGate = "if(active?.step_code==='CONTACT_DISCOVERY'&&!selectedRanked().length)executable=false;";
const newGate = "const researchQueueReady=Boolean(evidence.search_run_id)&&Array.isArray(evidence.candidates)&&evidence.candidates.length>0;if(active?.step_code==='CONTACT_DISCOVERY'&&!researchQueueReady)executable=false;";
const oldCopy = "active?.step_code==='CONTACT_DISCOVERY'&&!selectedRanked().length?'Select ranked contractors below before Stage 06.':";
const newCopy = "active?.step_code==='CONTACT_DISCOVERY'&&!researchQueueReady?'Stage 05 requires a persisted SAM contractor queue from Stage 04.':";

if (!source.includes(oldGate)) {
  throw new Error('[ngcc-stage05-auto-queue-gate] stale CONTACT_DISCOVERY selection gate was not found.');
}
if (!source.includes(oldCopy)) {
  throw new Error('[ngcc-stage05-auto-queue-gate] stale Stage 05 selection instruction was not found.');
}

source = source.replace(oldGate, newGate).replace(oldCopy, newCopy);

if (source.includes('Select ranked contractors below before Stage 06.')) {
  throw new Error('[ngcc-stage05-auto-queue-gate] stale selection instruction remains after patch.');
}

fs.writeFileSync(target, source, 'utf8');
console.log('[ngcc-stage05-auto-queue-gate] Stage 05 now executes from the persisted SAM contractor queue with no manual candidate selection gate.');
