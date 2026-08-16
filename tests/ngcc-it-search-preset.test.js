'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const v5 = fs.readFileSync(path.join(process.cwd(), 'ops-command-center-v5.html'), 'utf8');
const opsSearch = fs.readFileSync(path.join(process.cwd(), 'netlify/functions/ngcc-ops-sam-opportunities.js'), 'utf8');

const fullItCodes = [
  '541511', '541512', '541519', '518210', '513210', '541513',
  '541715', '541690', '517111', '517112', '517410', '517810',
  '334111', '334112', '334118', '334210', '423430', '611420', '561320',
];

assert.match(v5, /id="naicsPreset"/, 'Stage 01 must expose the NAICS search-category selector');
assert.match(v5, /Information Technology — Core \(6 NAICS\)/, 'Stage 01 must expose the six-code core IT preset');
assert.match(v5, /Information Technology — Full \(19 NAICS\)/, 'Stage 01 must expose the 19-code full IT preset');
assert.match(v5, /id="ngcc-it-search-preset-script"/, 'Stage 01 must initialize the IT preset behavior in the rendered command center');
for (const code of fullItCodes) {
  assert.ok(v5.includes(code), `Full IT preset must include NAICS ${code}`);
}

assert.match(opsSearch, /const MAX_NAICS_CODES = 25;/, 'SAM operator search must accept the complete 19-code IT preset');
assert.match(opsSearch, /new Set\(naicsParam\.split\(','\)/, 'SAM operator search must deduplicate requested NAICS codes');
assert.match(opsSearch, /for \(let i = 0; i < paths\.length; i \+= concurrency\)/, 'broad NAICS presets must execute every search path before ranking');
assert.doesNotMatch(opsSearch, /paths\.length && results\.length < limit/, 'broad NAICS presets must not stop after early high-volume codes fill the display limit');

console.log('NGCC Information Technology Stage 01 search preset validation passed.');
