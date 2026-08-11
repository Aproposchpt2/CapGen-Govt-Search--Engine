'use strict';

const { json, opsGuard, SUPABASE_URL, SUPABASE_KEY, sbHeaders } = require('./lib/ngcc-ops');

const MISSIONS = 'ngcc_procurement_missions';

function ensureDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('NGCC operational database configuration is incomplete.');
}

async function db(method, query = '', body, prefer = '') {
  ensureDb();
  const response = await fetch(`${String(SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/${MISSIONS}${query}`, {
    method,
    headers: { ...sbHeaders(), ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Mission evidence ${method} failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;

  try {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }

    const missionId = String(body.mission_id || '').trim();
    if (!missionId) return json(400, { ok: false, error: 'mission_id is required.' });
    const operationalState = body.operational_state && typeof body.operational_state === 'object' && !Array.isArray(body.operational_state)
      ? body.operational_state
      : {};

    const updated = await db(
      'PATCH',
      `?id=eq.${encodeURIComponent(missionId)}&select=id,mission_number,updated_at`,
      { operational_state: operationalState, updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() },
      'return=representation'
    );
    if (!updated.length) return json(404, { ok: false, error: 'Mission was not found.' });
    return json(200, { ok: true, mission_id: missionId, persisted: true });
  } catch (error) {
    console.error('[ngcc-ops-mission-evidence]', error);
    return json(500, { ok: false, error: String(error?.message || 'Mission evidence persistence failed.') });
  }
};
