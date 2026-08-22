import { buildAnalyzeFitDocx, analyzeFitDocxFilename } from './lib/analyze-fit-docx.mjs';
import { loadMergedAnalyzeProfile } from './_shared/ngcc-analyze-profile.mjs';

const SUPABASE_URL=process.env.SUPABASE_URL, SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const CORS={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Cache-Control':'no-store'};
const sbH=()=>({apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'});
async function sbGet(path){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:sbH()});if(!r.ok)throw new Error(`Supabase GET: ${(await r.text()).slice(0,180)}`);return r.json()}
async function verifySession(h){if(!h?.startsWith('Bearer '))return null;const t=h.slice(7).trim();if(!t)return null;try{const rows=await sbGet(`client_sessions?session_token=eq.${encodeURIComponent(t)}&revoked=eq.false&limit=1`);if(!rows[0]||new Date(rows[0].expires_at)<new Date())return null;return {email:rows[0].email.toLowerCase().trim(),isBeta:false}}catch{return null}}
async function verifyBeta(t){if(!t||!t.startsWith('beta_'))return null;try{const rows=await sbGet(`beta_testers?access_token=eq.${encodeURIComponent(t)}&status=eq.active&limit=1`);if(!rows[0]||(rows[0].token_expires_at&&new Date(rows[0].token_expires_at)<new Date()))return null;return {email:rows[0].email.toLowerCase().trim(),isBeta:true}}catch{return null}}
async function verifyViewToken(t){if(!t)return null;try{const rows=await sbGet(`demo_snapshots?view_token=eq.${encodeURIComponent(t)}&status=eq.complete&select=requester_email&limit=1`);return rows[0]?.requester_email?{email:rows[0].requester_email.toLowerCase().trim(),isBeta:false}:null}catch{return null}}
function json(status,body){return{statusCode:status,headers:CORS,body:JSON.stringify(body)}}
async function loadProfile(account){
  if(account.isBeta){const rows=await sbGet(`beta_testers?email=eq.${encodeURIComponent(account.email)}&limit=1`);const t=rows[0];if(!t)return null;return{business_name:t.company_name||'',legal_name:t.company_name||'',cage:t.cage_code||'',naics:[t.primary_naics,...(t.additional_naics||[])].filter(Boolean),set_asides:[],certifications:[],capabilities:'IT services, computer systems design',past_performance:'Not specified',team_size:'Not specified',keywords:[]}}
  const merged=await loadMergedAnalyzeProfile(sbGet,account.email);if(merged)return merged;
  const rows=await sbGet(`demo_snapshots?requester_email=eq.${encodeURIComponent(account.email)}&status=eq.complete&order=created_at.desc&limit=1`);const snap=rows[0];if(!snap)return null;const p=snap.profile||{};return{...p,business_name:p.legal_name||snap.business_name||p.business_name||'',legal_name:p.legal_name||snap.business_name||p.business_name||'',naics:(p.naics||[]).map(n=>n?.code||n),capabilities:p.capabilities||'Not specified',past_performance:p.past_performance||'Not specified'}
}

export const handler=async event=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  if(event.httpMethod!=='POST')return json(405,{error:'POST only'});
  let body;try{body=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Invalid JSON'})}
  let account=await verifySession(event.headers?.authorization||event.headers?.Authorization||'');
  if(!account&&body.beta_token)account=await verifyBeta(body.beta_token);
  if(!account&&body.view_token)account=await verifyViewToken(body.view_token);
  if(!account)return json(401,{error:'UNAUTHORIZED'});
  const opportunityId=body.opportunityId||body.opportunity_id;
  const inventorySource=body.inventorySource==='state_local'?'state_local':'federal';
  if(!opportunityId)return json(400,{error:'opportunityId required'});
  try{
    const opportunityKey=`${inventorySource}:${opportunityId}`;
    const ae=encodeURIComponent(account.email),oid=encodeURIComponent(opportunityKey);
    const rows=await sbGet(`opportunity_analyses?account_email=eq.${ae}&opportunity_id=eq.${oid}&status=eq.complete&order=created_at.desc&limit=1`);
    const row=rows[0];if(!row)return json(404,{error:'Completed Analyze Fit report not found.'});
    const profile=await loadProfile(account);if(!profile)return json(409,{error:'Business profile not found.'});
    const oppRows=inventorySource==='state_local'
      ? await sbGet(`state_contract_opportunities?id=eq.${encodeURIComponent(opportunityId)}&natcorp_release_status=eq.eligible&is_latest_version=eq.true&limit=1`)
      : await sbGet(`sam_opportunities?notice_id=eq.${encodeURIComponent(opportunityId)}&limit=1`);
    const opportunity=oppRows[0]||{notice_id:opportunityId,title:row.stage1?._title||'Selected Opportunity'};
    const payload={row,profile,opportunity,notice_id:opportunityId,inventory_source:inventorySource,report_standard:'APROPOS-ANALYZE-FIT-READABLE-v2'};
    const document=buildAnalyzeFitDocx(payload),filename=analyzeFitDocxFilename(payload);
    return{statusCode:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="${filename}"`,'Content-Length':String(document.length),'Cache-Control':'no-store, private','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'},body:document.toString('base64'),isBase64Encoded:true};
  }catch(error){console.error('[rfcp-analyze-fit-docx]',error);return json(500,{error:'The Word report could not be generated.'})}
};
