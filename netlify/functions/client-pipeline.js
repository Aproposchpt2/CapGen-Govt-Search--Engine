// client-pipeline.js
// Pulls live SAM.gov contract opportunities for a client's profile NAICS codes.
// Supported identifiers:
//   ?uei=bc:email@example.com  -> Business Center member OR direct CapGen login bridge email
//   ?uei=cg:email@example.com  -> Direct CapGen customer
//   ?uei=UEI123                -> CapGen subscription / known UEI profile
'use strict';

const OPP_URL = 'https://api.sam.gov/opportunities/v2/search';
const PAGE_LIMIT = 100;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://judislfknmhofcgzyozc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const CLIENT_NAICS = {
  'C13JZV6AY6L4': { name: 'CUSTOM IT SERVICES LLC', naics: ['541519','541511','541512','541513','541990','541690','541370','541330','517919','238210'], psc: ['DB10','DF10','DG10','DG11','DJ10','R499','R799'] },
  'YVNXN3XBUSD5': { name: 'Apropos Group LLC', naics: ['541512','541511','541519','541330','541370','541611','541618','561210'] },
};

const BC_DEFAULT_NAICS = ['541611','541618','541990'];
const BC_INDUSTRY_RULES = [
  { terms: ['it','technology','software','web','network','cyber','computer','telecom','communications','ai','automation'], naics: ['541512','541511','541519','518210','541513'] },
  { terms: ['construction','contractor','trade','electrical','plumbing','hvac','building','repair','renovation'], naics: ['236220','238210','238220','238990','541330'] },
  { terms: ['janitorial','cleaning','custodial','facilities','facility','maintenance'], naics: ['561720','561210','561790'] },
  { terms: ['landscaping','grounds','lawn','tree'], naics: ['561730'] },
  { terms: ['security','guard','patrol'], naics: ['561612'] },
  { terms: ['staffing','recruiting','employment','temporary'], naics: ['561311','561320'] },
  { terms: ['marketing','advertising','media','public relations','branding'], naics: ['541613','541810','541820','541430'] },
  { terms: ['consulting','business service','professional service','management'], naics: ['541611','541618','541690'] },
  { terms: ['transportation','trucking','delivery','logistics'], naics: ['484110','484220','488510'] },
  { terms: ['food','restaurant','catering','meal'], naics: ['722310','722320','311991'] },
];

const sbHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY });

// Verifies the caller's session_token against client_sessions and returns the
// authenticated email, or null. bc_email/cg_email query params are client-supplied
// and must never be trusted as identity on their own — see NGCC S1 cross-tenant fix.
async function verifySession(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/client_sessions?session_token=eq.' + encodeURIComponent(token) + '&revoked=eq.false&limit=1', { headers: sbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows[0]) return null;
    if (new Date(rows[0].expires_at) < new Date()) return null;
    return String(rows[0].email || '').toLowerCase().trim() || null;
  } catch { return null; }
}

const uniq = arr => [...new Set((arr || []).map(String).map(s => s.trim()).filter(Boolean))];
function naicsFromIndustry(industry) { const hay = String(industry || '').toLowerCase(); const out = []; for (const rule of BC_INDUSTRY_RULES) if (rule.terms.some(t => hay.includes(t))) out.push(...rule.naics); return uniq(out.length ? out : BC_DEFAULT_NAICS).slice(0, 8); }
function normalizeNaics(value) { if (Array.isArray(value)) return uniq(value); if (typeof value === 'string') { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return uniq(parsed); } catch (_) {} return uniq(value.split(/[\s,;|]+/)); } return []; }

async function fetchClientFromDB(uei) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !uei) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/capgen_subscriptions?uei=eq.' + encodeURIComponent(uei) + '&status=eq.active&limit=1', { headers: sbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    const sub = rows[0];
    const naics = normalizeNaics(sub.naics);
    if (!naics.length) return null;
    return { name: sub.business_name || uei, business_name: sub.business_name || uei, naics, cage: sub.cage || null, city: sub.address ? sub.address.split(',')[0].trim() : null, state: sub.address ? (sub.address.split(',')[1] || '').trim() : null, psc: (CLIENT_NAICS[uei] || {}).psc || [], member_type: 'capgen_subscriber', source: 'capgen_subscriptions', uei };
  } catch { return null; }
}

async function fetchDirectCapGenCustomer(email) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !email) return null;
  try {
    const cleanEmail = String(email).trim().toLowerCase();
    const select = 'email,full_name,business_name,uei,cage,city,state,naics,capabilities,certifications,set_asides,status,current_period_end,subscription_tier,profile_complete,source';
    const res = await fetch(SUPABASE_URL + '/rest/v1/capgen_customers?email=eq.' + encodeURIComponent(cleanEmail) + '&access_activated=eq.true&select=' + encodeURIComponent(select) + '&limit=1', { headers: sbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const c = rows[0];
    const active = ['active','trial'].includes(String(c.status || '').toLowerCase()) || (c.current_period_end && new Date(c.current_period_end) > new Date());
    if (!active) return null;
    let naics = normalizeNaics(c.naics);
    if (!naics.length && c.uei && CLIENT_NAICS[c.uei]) naics = CLIENT_NAICS[c.uei].naics;
    return { name: c.business_name || c.full_name || cleanEmail, business_name: c.business_name || c.full_name || cleanEmail, naics, cage: c.cage || null, city: c.city || null, state: c.state || null, psc: [], member_type: 'capgen_direct', source: 'capgen_customers', email: cleanEmail, uei: c.uei || 'cg:' + cleanEmail, subscription_tier: c.subscription_tier || null, profile_complete: !!c.profile_complete };
  } catch { return null; }
}

async function fetchBCMemberClient(email) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !email) return null;
  const cleanEmail = String(email).trim().toLowerCase();
  // Critical: a direct CapGen customer may authenticate through a temporary biz_center_members bridge.
  // Prefer capgen_customers so first-login dashboard generation uses the CapGen product path, not the bridge profile.
  const direct = await fetchDirectCapGenCustomer(cleanEmail);
  if (direct) return direct;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/biz_center_members?email=eq.' + encodeURIComponent(cleanEmail) + '&select=email,full_name,business_name,industry,city,state,business_stage,subscription_status,trial_end&limit=1', { headers: sbHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const member = rows[0];
    const trialEnd = new Date(member.trial_end);
    const active = member.subscription_status === 'active' || member.subscription_status === 'trialing' || (member.subscription_status === 'trial' && trialEnd > new Date());
    if (!active) return null;
    return { name: member.business_name || member.full_name || cleanEmail, business_name: member.business_name || member.full_name || cleanEmail, naics: naicsFromIndustry(member.industry), cage: null, city: member.city || null, state: member.state || null, psc: [], member_type: 'bc_member', business_stage: member.business_stage || null, email: cleanEmail, source: 'biz_center_members', uei: 'bc:' + cleanEmail };
  } catch { return null; }
}

function mmddyyyy(d) { const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${mm}/${dd}/${d.getFullYear()}`; }
function daysUntil(deadline) { if (!deadline) return null; return Math.floor((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)); }
function urgencyClass(days) { if (days === null || days < 1) return 'none'; if (days <= 7) return 'hot'; if (days <= 30) return 'warm'; return 'ok'; }

async function fetchOpps(naics, postedFrom, postedTo) { const url = new URL(OPP_URL); url.searchParams.set('api_key', process.env.SAM_API_KEY); url.searchParams.set('postedFrom', postedFrom); url.searchParams.set('postedTo', postedTo); url.searchParams.set('ncode', naics); url.searchParams.set('limit', String(PAGE_LIMIT)); url.searchParams.set('offset', '0'); const res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) throw new Error(`SAM opp ${res.status} (${naics})`); const data = await res.json(); return data.opportunitiesData || []; }
async function fetchOppsByPSC(psc, postedFrom, postedTo) { const url = new URL(OPP_URL); url.searchParams.set('api_key', process.env.SAM_API_KEY); url.searchParams.set('postedFrom', postedFrom); url.searchParams.set('postedTo', postedTo); url.searchParams.set('psc', psc); url.searchParams.set('limit', String(PAGE_LIMIT)); url.searchParams.set('offset', '0'); const res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) throw new Error(`SAM opp PSC ${res.status} (${psc})`); const data = await res.json(); return data.opportunitiesData || []; }

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const qs = event.queryStringParameters || {};
  const requested = String(qs.uei || qs.client || '').trim();
  let bcEmail = qs.bc_email || (requested.startsWith('bc:') ? requested.slice(3) : '');
  let cgEmail = qs.cg_email || (requested.startsWith('cg:') ? requested.slice(3) : '');
  const includeClosed = qs.include_closed === '1';
  const days = Math.min(90, Math.max(1, parseInt(qs.days || '60', 10)));

  if (!requested && !bcEmail && !cgEmail) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No client identifier supplied. First-login automation requires a Business Center email, direct CapGen email, or explicit UEI.' }) };

  // bc_email/cg_email requests represent an authenticated dashboard session — the
  // email must come from a verified session_token, never trusted from the query
  // string alone, or any caller could pull any business's profile by supplying
  // a different email (confirmed exploitable prior to this fix).
  if (bcEmail || cgEmail) {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const verifiedEmail = await verifySession(authHeader);
    if (!verifiedEmail) return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
    if (bcEmail) bcEmail = verifiedEmail;
    if (cgEmail) cgEmail = verifiedEmail;
  }

  let client = null;
  let resolvedId = requested;
  if (cgEmail) { resolvedId = 'cg:' + cgEmail; client = await fetchDirectCapGenCustomer(cgEmail); }
  else if (bcEmail) { resolvedId = 'bc:' + bcEmail; client = await fetchBCMemberClient(bcEmail); }
  else { client = (await fetchClientFromDB(requested)) || CLIENT_NAICS[requested] || null; if (client && !client.uei) client.uei = requested; }

  if (!client) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Client profile not found. Complete first-login onboarding before opening the dashboard.' }) };
  if (!client.naics || !client.naics.length) return { statusCode: 409, headers, body: JSON.stringify({ error: 'Client profile found, but no NAICS codes are available yet. First-login automation must scan or enrich the capability profile before creating the dashboard.', client }) };
  if (!process.env.SAM_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'SAM_API_KEY not set' }) };

  const now = new Date(); const from = new Date(now); from.setDate(from.getDate() - days); const postedFrom = mmddyyyy(from); const postedTo = mmddyyyy(now); const seen = new Map();
  for (const naics of client.naics) { try { const opps = await fetchOpps(naics, postedFrom, postedTo); for (const o of opps) if (o.noticeId && !seen.has(o.noticeId)) seen.set(o.noticeId, o); } catch (e) { console.error(e.message); } }
  for (const psc of (client.psc || [])) { try { const opps = await fetchOppsByPSC(psc, postedFrom, postedTo); for (const o of opps) if (o.noticeId && !seen.has(o.noticeId)) seen.set(o.noticeId, o); } catch (e) { console.error(e.message); } }

  const mapped = [...seen.values()].map(o => { const days_left = daysUntil(o.responseDeadLine); return { notice_id: o.noticeId, title: o.title, agency: o.fullParentPathName, type: o.type, naics: o.naicsCode, set_aside: o.typeOfSetAsideDescription || o.setAside || 'None', posted_date: o.postedDate, deadline: o.responseDeadLine, days_left, urgency: urgencyClass(days_left), url: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view` }; });
  const results = mapped.filter(o => includeClosed || (o.days_left !== null && o.days_left >= 1)).sort((a, b) => { if (!a.deadline && !b.deadline) return 0; if (!a.deadline) return 1; if (!b.deadline) return -1; return new Date(a.deadline) - new Date(b.deadline); });

  return { statusCode: 200, headers, body: JSON.stringify({ client: { uei: client.uei || resolvedId, name: client.name, business_name: client.business_name || client.name, naics: client.naics, city: client.city || null, state: client.state || null, cage: client.cage || null, member_type: client.member_type || 'capgen_subscriber', source: client.source || null, profile_complete: !!client.profile_complete }, window_days: days, total: results.length, opportunities: results }) };
};
