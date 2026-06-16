'use strict';
// list-entities.js — POST { session_token }
// Returns the entities (business profiles) under the session's account, plus
// the currently active entity. Drives the Commander dashboard switcher.
// Scout/Operator accounts simply return their single primary entity.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbH() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }

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
  const token = (body.session_token || '').trim();
  if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'session_token required' }) };

  const session = await getSession(token);
  if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session.' }) };

  const eres = await fetch(
    `${SUPABASE_URL}/rest/v1/capgen_entities?account_email=eq.${encodeURIComponent(session.email)}`
    + `&select=id,label,business_name,uei,entity_index,is_primary,onboarding_state&order=entity_index.asc`,
    { headers: sbH() }
  );
  const entities = eres.ok ? await eres.json() : [];
  const list = Array.isArray(entities) ? entities : [];

  // Default the active entity to the primary/first if the session has none yet.
  let activeId = session.active_entity_id;
  if (!activeId && list[0]) activeId = list[0].id;

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ email: session.email, active_entity_id: activeId, entities: list }),
  };
};
