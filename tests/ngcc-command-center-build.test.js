'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'ops-command-center-v5.html');
const html = fs.readFileSync(target, 'utf8');

assert.match(html, /ngcc-execution-dock/, 'tablet sticky execution patch must be present in built v5');
assert.match(html, /Discovery Match/, 'Stage 05 must expose Discovery Match in built v5');
assert.match(html, /Contract Qualification/, 'Stage 05 must expose Contract Qualification in built v5');
assert.match(html, /Not scored/, 'Stage 05 must explicitly render an unscored qualification state');

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\ssrc\s*=/.test(match[0]))
  .map(match => match[1]);

assert.ok(inlineScripts.length > 0, 'built v5 must contain at least one inline script');

inlineScripts.forEach((script, index) => {
  try {
    // Parse browser script syntax without executing it. This catches malformed
    // build-time string injection before the command center reaches production.
    new Function(script);
  } catch (error) {
    throw new Error(`Built NGCC v5 inline script ${index + 1} has invalid JavaScript syntax: ${error.message}`);
  }
});

console.log(`NGCC command-center build syntax validation passed (${inlineScripts.length} inline script(s)).`);
