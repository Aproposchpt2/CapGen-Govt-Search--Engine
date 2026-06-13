'use strict';
// POST { email } → looks up active beta_testers row → returns dashboard_url for instant redirect.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL     = 'https://capgen.aproposgroupllc.com';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid email required.' }) };
  }

  const res  = await fetch(
    `${SUPABASE_URL}/rest/v1/beta_testers?email=eq.${encodeURIComponent(email)}&status=eq.active&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json();

  if (!Array.isArray(rows) || !rows[0]) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
  }

  const tester = rows[0];
  if (tester.token_expires_at && new Date(tester.token_expires_at) < new Date()) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false, expired: true }) };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      found:         true,
      dashboard_url: `${SITE_URL}/demo/snapshot?t=${encodeURIComponent(tester.access_token)}`,
    }),
  };
};
