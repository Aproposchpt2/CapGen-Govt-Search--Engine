'use strict';
// demo-create.js — NGCC federal dashboard orchestrator
// Every intake creates a fresh snapshot and triggers a fresh federal profile scan.

const crypto       = require('crypto');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL     = process.env.DEPLOY_URL || process.env.URL || '';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbH(extra) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  }, extra || {});
}

async function sbInsert(table, row) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: sbH({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error('Insert ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (body.hp) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };

  const uei          = String(body.uei || '').trim();
  const businessName = String(body.businessName || '').trim();
  const firstName    = String(body.firstName || '').trim();
  const lastName     = String(body.lastName || '').trim();
  const email        = String(body.email || '').trim().toLowerCase();
  const ip           = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown';

  if (!uei || !businessName || !email || !firstName) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'UEI, business name, first name, and email are required' }) };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const viewToken = crypto.randomBytes(32).toString('hex');
  let row;
  try {
    row = await sbInsert('demo_snapshots', {
      entity_uei: uei,
      business_name: businessName,
      requester_email: email,
      requester_name: (firstName + ' ' + lastName).trim(),
      requester_ip: ip,
      profile: {},
      view_token: viewToken,
      status: 'pending',
    });
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to create dashboard snapshot: ' + e.message }) };
  }

  try {
    await fetch(SITE_URL + '/.netlify/functions/demo-create-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rowId: row.id,
        uei,
        businessName,
        firstName,
        lastName,
        email,
        viewToken,
      }),
    });
  } catch (e) {
    console.error('[demo-create] background dispatch failed:', e.message);
  }

  return {
    statusCode: 202,
    headers: CORS,
    body: JSON.stringify({ view_token: viewToken, status: 'pending', fresh_scan: true }),
  };
};