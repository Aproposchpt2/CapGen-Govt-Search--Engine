'use strict';
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'ops-command-center-v5.html');
let source = fs.readFileSync(target, 'utf8');

function replaceRequired(needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`[ngcc-it-search-preset] required marker not found: ${label}`);
  }
  source = source.replace(needle, replacement);
}

const presetMarker = 'id="naicsPreset"';
if (!source.includes(presetMarker)) {
  replaceRequired(
    '<div><label>NAICS</label><input id="naics" placeholder="optional"></div><div><label>Contract State</label>',
    '<div><label>Search Category</label><select id="naicsPreset"><option value="">Custom NAICS</option><option value="it_core">Information Technology — Core (6 NAICS)</option><option value="it_full">Information Technology — Full (19 NAICS)</option></select><small class="muted">Choose an IT preset or enter NAICS manually.</small></div><div><label>NAICS</label><input id="naics" placeholder="optional"></div><div><label>Contract State</label>',
    'Stage 01 NAICS search-category control'
  );

  const injectionNeedle = "    html = html.replace('</body>', stateFilterScript + dateRangeScript + '</body>');";
  const injectionReplacement = "    const itSearchPresetScript = `<script id=\"ngcc-it-search-preset-script\">(()=>{const PRESETS={it_core:['541511','541512','541519','518210','513210','541513'],it_full:['541511','541512','541519','518210','513210','541513','541715','541690','517111','517112','517410','517810','334111','334112','334118','334210','423430','611420','561320']};const preset=document.getElementById('naicsPreset'),naics=document.getElementById('naics');if(!preset||!naics)return;const valueFor=key=>(PRESETS[key]||[]).join(',');const apply=()=>{const value=valueFor(preset.value);if(value)naics.value=value};preset.addEventListener('change',apply);naics.addEventListener('input',()=>{if(preset.value&&naics.value.trim()!==valueFor(preset.value))preset.value=''});const newTask=document.getElementById('startNewTask');if(newTask)newTask.addEventListener('click',()=>setTimeout(()=>{preset.value=''},0))})();<\\/script>`;\n    html = html.replace('</body>', stateFilterScript + dateRangeScript + itSearchPresetScript + '</body>');";
  replaceRequired(injectionNeedle, injectionReplacement, 'Stage 01 IT preset runtime initialization');

  console.log('[ngcc-it-search-preset] added Information Technology core/full NAICS presets to Stage 01.');
} else {
  console.log('[ngcc-it-search-preset] Stage 01 IT NAICS presets already present.');
}

fs.writeFileSync(target, source, 'utf8');
