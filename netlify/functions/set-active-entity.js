'use strict';
// set-active-entity.js — POST { session_token, entity_id }
// Switches which entity the session is viewing. The entity MUST belong to the
// session's account (isolation) — you cannot switch into another account's data.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbH(extra) { return Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, extra || {}); }

async function getSession(token) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/client_sessions?session_token=eq.${encodeURIComponent(token)}&revoked=eq.false&limit=1`,
    { headers: sbH() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const s = Array.isArray(rows) && rows[0];
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) return null;
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const token    = (body.session_token || '').trim();
  const entityId = (body.entity_id || '').trim();
  if (!token || !entityId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'session_token and entity_id required' }) };

  const session = await getSession(token);
  if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session.' }) };

  // The entity must belong to THIS account — scope by account_email + id.
  const eres = await fetch(
    `${SUPABASE_URL}/rest/v1/capgen_entities?id=eq.${encodeURIComponent(entityId)}`
    + `&account_email=eq.${encodeURIComponent(session.email)}&select=id,label,business_name,uei&limit=1`,
    { headers: sbH() }
  );
  const erows = eres.ok ? await eres.json() : [];
  const entity = Array.isArray(erows) && erows[0];
  if (!entity) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Entity not found for this account.' }) };

  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/client_sessions?session_token=eq.${encodeURIComponent(token)}`,
    { method: 'PATCH', headers: sbH({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ active_entity_id: entityId }) }
  );
  if (!patch.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not switch entity.' }) };

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, active_entity: entity }) };
};
