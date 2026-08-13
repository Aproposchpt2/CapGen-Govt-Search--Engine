const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'ops-command-center-v5.html');
let source = fs.readFileSync(target, 'utf8');

const alreadyApplied = "const qualificationUiStart=html.indexOf(\"function renderRanked(){\")";
if (source.includes(alreadyApplied)) {
  console.log('[ngcc-qualification-v2-ui] patch already present; no changes needed.');
  process.exit(0);
}

const insertionMarker = "    const executionTail = '<div id=\"execMsg\" class=\"msg\"></div><div id=\"stageOutput\"></div></section>';";
if (!source.includes(insertionMarker)) {
  throw new Error('[ngcc-qualification-v2-ui] required v5 insertion marker was not found.');
}

const uiPatch = `    // Stage 05 v2: distinguish why a business was discovered from whether
    // current evidence shows it can perform this specific contract. A missing
    // qualification score is rendered as "Not scored" rather than a false 50%.
    const qualificationUiStart=html.indexOf("function renderRanked(){");
    const qualificationUiEnd=html.indexOf("function renderContacts(){",qualificationUiStart);
    if(qualificationUiStart<0||qualificationUiEnd<0)throw new Error('Stage 05 qualification v2 UI markers were not found.');
    const qualificationUiFunction=\`function renderRanked(){const rows=evidence.ranked_candidates||[];if(!rows.length){$('ranked').innerHTML='<div class="muted">No Stage 05 output yet.</div>';return}const q=v=>Number.isFinite(Number(v))?Number(v):null;$('ranked').innerHTML=\\\`<table><thead><tr><th>Select</th><th>Rank</th><th>Business</th><th>Discovery Match</th><th>Contract Qualification</th><th>Status</th><th>Evidence</th></tr></thead><tbody>\\\${rows.map((c,i)=>{const discovery=q(c.discovery_match_score);const qualification=q(c.contract_qualification_score??c.qualification_score);const coverage=q(c.evidence_coverage_percentage);const visualStatus=c.qualification_status==='INSUFFICIENT_EVIDENCE'?'REVIEW_REQUIRED':c.qualification_status;return\\\`<tr><td><input type="checkbox" data-rank-select="\\\${i}" \\\${c.operator_selected?'checked':''} \\\${c.qualification_status==='DISQUALIFIED'?'disabled':''}></td><td>\\\${esc(c.rank)}</td><td><b>\\\${esc(c.business_name)}</b><br>\\\${esc(c.city||'')}\\\${c.state?', '+esc(c.state):''}</td><td><b>\\\${discovery===null?'—':esc(discovery)+'/100'}</b><br><small>\\\${esc(c.discovery_match_status||'Discovery evidence')}</small></td><td><b>\\\${qualification===null?'Not scored':esc(qualification)+'/100'}</b><br><small>\\\${coverage===null?'Evidence coverage unavailable':esc(coverage)+'% evidence coverage'}</small></td><td><span class="pill \\\${esc(visualStatus)}">\\\${esc(c.qualification_status)}</span></td><td><details><summary>Why ranked</summary>\\\${(c.explanation?.why_ranked||[]).map(x=>\\\`<div>• \\\${esc(x)}</div>\\\`).join('')}<div class="warntext">\\\${(c.explanation?.verification_required||[]).filter(x=>x.status==='UNVERIFIED').length} verification item(s)</div>\\\${(c.explanation?.verification_required||[]).filter(x=>x.status==='MISMATCH').length?\\\`<div class="err">\\\${(c.explanation?.verification_required||[]).filter(x=>x.status==='MISMATCH').length} affirmative mismatch(es)</div>\\\`:''}</details></td></tr>\\\`}).join('')}</tbody></table>\\\`;document.querySelectorAll('[data-rank-select]').forEach(el=>el.onchange=()=>{evidence.ranked_candidates[Number(el.dataset.rankSelect)].operator_selected=el.checked;saveEvidence();render()})}\`;
    html=html.slice(0,qualificationUiStart)+qualificationUiFunction+html.slice(qualificationUiEnd);

`;

source = source.replace(insertionMarker, uiPatch + insertionMarker);
fs.writeFileSync(target, source, 'utf8');
console.log('[ngcc-qualification-v2-ui] Stage 05 now shows Discovery Match and Contract Qualification separately.');
