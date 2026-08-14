'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const v5Path = path.join(process.cwd(), 'ops-command-center-v5.html');
const v3Path = path.join(process.cwd(), 'ops-command-center-v3.html');
const v5 = fs.readFileSync(v5Path, 'utf8');
const v3 = fs.readFileSync(v3Path, 'utf8');

assert.match(v5, /ngcc-execution-dock/, 'tablet sticky execution patch must be present in built v5');
assert.match(v5, /ops-command-center-v3\.html\?v5=4/, 'v5 must load the canonical patched v3 command-center document');

assert.match(v3, /Discovery Match/, 'built v3 must expose Discovery Match');
assert.match(v3, /Contract Qualification/, 'built v3 must expose Contract Qualification');
assert.match(v3, /Not scored/, 'built v3 must explicitly render an unscored qualification state');
assert.match(v3, /Contractor Research & Contact Discovery/, 'built v3 must route contractor research before qualification');
assert.match(v3, /Stage 05 Research Worker Monitor/, 'built v3 must expose the five-worker Stage 05 monitor');
assert.match(v3, /researchQueueReady=Boolean\(evidence\.search_run_id\)/, 'built v3 must enable Stage 05 from the persisted SAM research queue');
assert.match(v3, /Stage 05 requires a persisted SAM contractor queue from Stage 04\./, 'built v3 must explain the real Stage 05 prerequisite');
assert.doesNotMatch(v3, /Select ranked contractors below before Stage 06\./, 'built v3 must not require retired manual Stage 05 contractor selection');
assert.match(v3, /qualification_status==='QUALIFIED'&&c\.contact_verified===true/, 'Stage 07 selector must render only truly qualified contractors with verified public contacts');
assert.match(v3, /outreach_approved:true/, 'qualified outreach-ready contractors must default selected');
assert.match(v3, /data-outreach-select/, 'Stage 07 must render individual recipient selection checkboxes');
assert.match(v3, /Select All/, 'built v3 must expose outreach Select All');
assert.match(v3, /Clear All/, 'built v3 must expose outreach Clear All');
assert.match(v3, /Opportunity email drafts — review, edit, save, then send/, 'built v3 must expose the Stage 07 draft review gate');
assert.match(v3, /Save Draft/, 'built v3 must expose Save Draft');
assert.match(v3, /Approve and Send This Business/, 'built v3 must require explicit per-business send approval');
assert.match(v3, /Prospective client emailed\. Operator notification emailed\./, 'built v3 must report the dual-send completion result');
assert.match(v3, /action:'save'/, 'built v3 must save an edited draft through the outreach API');
assert.match(v3, /action:'send'/, 'built v3 must explicitly invoke production send after review');
assert.doesNotMatch(v3, /Stage 06 is limited to five businesses per controlled website research run/, 'built v3 must not retain the old five-business research ceiling');
assert.doesNotMatch(v3, /selected\.length>5/, 'built v3 must not impose a browser-side five-candidate selection ceiling');

function parseInlineScripts(html, label) {
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\ssrc\s*=/.test(match[0]))
    .map(match => match[1]);

  assert.ok(inlineScripts.length > 0, `${label} must contain at least one inline script`);
  inlineScripts.forEach((script, index) => {
    try {
      // Parse browser script syntax without executing it. This catches malformed
      // build-time string injection before the command center reaches production.
      new Function(script);
    } catch (error) {
      throw new Error(`Built NGCC ${label} inline script ${index + 1} has invalid JavaScript syntax: ${error.message}`);
    }
  });
  return inlineScripts.length;
}

const v5Scripts = parseInlineScripts(v5, 'v5');
const v3Scripts = parseInlineScripts(v3, 'v3');
console.log(`NGCC command-center build syntax validation passed (${v5Scripts} v5 + ${v3Scripts} v3 inline script(s)).`);
