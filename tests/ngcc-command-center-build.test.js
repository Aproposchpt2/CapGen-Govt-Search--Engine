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
assert.match(v3, /Select All/, 'built v3 must expose outreach Select All');
assert.match(v3, /Clear All/, 'built v3 must expose outreach Clear All');
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
