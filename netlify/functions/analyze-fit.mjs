import { createHash } from 'node:crypto';
import { loadMergedAnalyzeProfile } from './_shared/ngcc-analyze-profile.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.DEPLOY_URL || process.env.URL || '';
const INTERNAL_TOKEN = process.env.ANALYZE_FIT_INTERNAL_SECRET || process.env.AUTH_TOKEN_SECRET;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const HEADERS = { 'Content-Type': 'application/json' };

function sbHeaders(extra = {}) { return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra }; }
async function sbGet(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!response.ok) throw new Error(`Supabase GET ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return response.json();
}
async function sbInsert(table, row) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: sbHeaders({ Prefer: 'return=representation' }), body: JSON.stringify(row) });
  if (!response.ok) throw new Error(`Supabase insert ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return (await response.json())[0];
}
async function sbRpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(body) });
  if (!response.ok) {
    const error = new Error((await response.text()).slice(0, 240) || `RPC ${name} failed`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function verifySession(header) {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const rows = await sbGet(`client_sessions?session_token=eq.${encodeURIComponent(token)}&revoked=eq.false&limit=1`);
    if (!rows[0] || new Date(rows[0].expires_at) < new Date()) return null;
    return rows[0].email.toLowerCase().trim();
  } catch { return null; }
}
async function verifyBeta(token) {
  if (!token?.startsWith('beta_')) return null;
  const rows = await sbGet(`beta_testers?access_token=eq.${encodeURIComponent(token)}&status=eq.active&limit=1`);
  if (!rows[0] || (rows[0].token_expires_at && new Date(rows[0].token_expires_at) < new Date())) return null;
  return rows[0].email.toLowerCase().trim();
}
async function verifyViewToken(token) {
  if (!token) return null;
  const rows = await sbGet(`demo_snapshots?view_token=eq.${encodeURIComponent(token)}&status=eq.complete&select=requester_email&limit=1`);
  return rows[0]?.requester_email?.toLowerCase().trim() || null;
}

function normalizeSource(value) { return value === 'state_local' ? 'state_local' : 'federal'; }
function validOpportunityId(source, id) {
  if (!id || id.length > 160) return false;
  return source === 'state_local' ? /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) : /^[A-Za-z0-9._:-]+$/.test(id);
}
async function loadOpportunity(source, id) {
  if (source === 'state_local') {
    const select = 'id,title,description,issuing_organization,solicitation_number,state_code,jurisdiction_name,place_of_performance_county,procurement_type,response_deadline,posted_at,package_document_count,match_readiness_status,status';
    const rows = await sbGet(`state_contract_opportunities?id=eq.${encodeURIComponent(id)}&natcorp_release_status=eq.eligible&is_latest_version=eq.true&select=${select}&limit=1`);
    const row = rows[0];
    if (!row) return null;
    return {
      inventory_source: 'state_local', source_opportunity_id: row.id, notice_id: row.id,
      title: row.title, description: row.description, agency: row.issuing_organization,
      solicitation_number: row.solicitation_number, response_deadline: row.response_deadline,
      package_document_count: Number(row.package_document_count || 0),
      package_status: Number(row.package_document_count || 0) > 0 ? 'available_not_asserted_complete' : 'unavailable',
      match_basis: 'business_capability_keywords',
      limitations: ['State/local matching does not use SAM NAICS.', 'Package completeness is not assumed.'],
      raw: { placeOfPerformance: { state: { code: row.state_code }, county: row.place_of_performance_county }, procurement_type: row.procurement_type },
    };
  }
  const rows = await sbGet(`sam_opportunities?notice_id=eq.${encodeURIComponent(id)}&select=notice_id,title,agency,naics_code,set_aside,response_deadline,solicitation_number,raw,resolved_description&limit=1`);
  if (!rows[0]) return null;
  return { ...rows[0], inventory_source: 'federal', source_opportunity_id: rows[0].notice_id, match_basis: 'sam_derived_naics', limitations: ['SAM.gov and the complete solicitation remain authoritative.'] };
}
function response(statusCode, body) { return { statusCode, headers: HEADERS, body: JSON.stringify(body) }; }

export const handler = async event => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'POST only' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Invalid JSON' }); }

  let accountEmail = await verifySession(event.headers?.authorization || event.headers?.Authorization || '');
  let authorizedTest = false;
  if (!accountEmail && body.beta_token) { accountEmail = await verifyBeta(body.beta_token); authorizedTest = Boolean(accountEmail); }
  if (!accountEmail && body.view_token) accountEmail = await verifyViewToken(body.view_token);
  if (!accountEmail) return response(401, { error: 'UNAUTHORIZED' });

  const source = normalizeSource(body.inventorySource);
  const opportunityId = String(body.opportunityId || '').trim();
  if (!validOpportunityId(source, opportunityId)) return response(400, { error: 'INVALID_OPPORTUNITY_ID' });
  const opportunity = await loadOpportunity(source, opportunityId);
  if (!opportunity) return response(404, { error: 'OPPORTUNITY_NOT_FOUND' });

  if (!authorizedTest && !(await loadMergedAnalyzeProfile(sbGet, accountEmail))) return response(409, { error: 'PROFILE_REQUIRED' });

  const opportunityKey = `${source}:${opportunityId}`;
  const emailFilter = encodeURIComponent(accountEmail);
  const keyFilter = encodeURIComponent(opportunityKey);
  const cached = await sbGet(`opportunity_analyses?account_email=eq.${emailFilter}&opportunity_id=eq.${keyFilter}&profile_version=eq.0&limit=1`);
  if (cached.length) return response(200, { ...cached[0], cached: true, inventory_source: source });

  const since = encodeURIComponent(new Date(Date.now() - 86400000).toISOString());
  const recent = await sbGet(`opportunity_analyses?account_email=eq.${emailFilter}&created_at=gte.${since}&select=id`);
  if (recent.length >= 50) return response(429, { error: 'DAILY_LIMIT', message: 'Analyze Fit daily safety limit reached.' });

  const requestedKey = String(event.headers?.['idempotency-key'] || '').trim();
  const idempotencyKey = createHash('sha256').update(`${accountEmail}|${opportunityKey}|${requestedKey || 'default'}`).digest('hex');
  let reservation;
  try {
    const rows = await sbRpc('rfcp_reserve_analyze_fit', { p_customer_email: accountEmail, p_opportunity_key: opportunityKey, p_idempotency_key: idempotencyKey });
    reservation = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (/No Analyze Fit entitlement/i.test(error.message)) return response(402, { error: 'OUT_OF_CREDITS', message: 'No active Analyze Fit entitlement or credit is available.' });
    return response(503, { error: 'ENTITLEMENT_UNAVAILABLE', message: 'Analyze Fit authorization could not be confirmed.' });
  }

  let row;
  try {
    row = await sbInsert('opportunity_analyses', {
      account_email: accountEmail, opportunity_id: opportunityKey, profile_version: 0,
      stage1: { _inventory_source: source, _source_opportunity_id: opportunityId, _package_status: opportunity.package_status || null },
      recommendation: 'PENDING', fit_score: 0, model: MODEL, status: 'pending',
    });
    if (!INTERNAL_TOKEN) throw new Error('Analyze Fit internal authorization is not configured.');
    const background = await fetch(`${SITE_URL}/.netlify/functions/analyze-fit-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-rfcp-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ rowId: row.id, accountEmail, opportunityId, opportunityKey, inventorySource: source, reservationId: reservation.request_id, profileVersion: 0, deep: true, isBeta: authorizedTest }),
    });
    if (!background.ok) throw new Error(`Background reservation failed (${background.status}).`);
  } catch (error) {
    if (reservation?.request_id) await sbRpc('rfcp_release_analyze_fit', { p_request_id: reservation.request_id, p_failure_code: 'orchestration_failed' }).catch(() => {});
    return response(500, { error: 'ANALYSIS_START_FAILED', message: error.message });
  }
  return response(202, { id: row.id, status: 'pending', opportunity_id: opportunityKey, inventory_source: source, cached: false });
};
