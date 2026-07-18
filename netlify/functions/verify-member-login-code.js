'use strict';
// Federal CapGen member login step 2 — verify OTP and return the dashboard session payload.

const crypto = require('crypto');
const DEFAULT_SUPABASE_URL = 'https://judislfknmhofcgzyozc.supabase.co';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.BC_SUPA_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BC_SUPA_KEY || '';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const sbH = (extra = {}) => ({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...extra });

function memberIsActive(member) {
  const status = String(member.subscription_status || '').toLowerCase();
  if (['active', 'trial', 'trialing', 'paid', 'comp'].includes(status)) return true;
  const trialEnd = member.trial_end ? Date.parse(member.trial_end) : 0;
  return Number.isFinite(trialEnd) && trialEnd > Date.now();
}

async function getMember(email) {
  const select = 'id,email,full_name,business_name,industry,city,state,subscription_status,trial_end,bc_access_activated';
  const url = `${SUPABASE_URL}/rest/v1/biz_center_members?email=eq.${encodeURIComponent(email)}&bc_access_activated=eq.true&select=${encodeURIComponent(select)}&limit=1`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows.length) return null;
  return memberIsActive(rows[0]) ? rows[0] : null;
}

function cleanupCodes(email) {
  fetch(`${SUPABASE_URL}/rest/v1/capgen_member_login_codes?email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: sbH({ Prefer: 'return=minimal' }),
  }).catch(err => console.error('[verify-member-login-code cleanup]', err.message));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { error: 'POST only' });
  if (!SERVICE_KEY) return j(500, { error: 'Supabase service key is not configured.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return j(400, { error: 'Invalid JSON' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return j(400, { error: 'Enter the 6-digit code.' });

  const nowIso = new Date().toISOString();
  const codeUrl = `${SUPABASE_URL}/rest/v1/capgen_member_login_codes?email=eq.${encodeURIComponent(email)}&code=eq.${encodeURIComponent(code)}&expires_at=gt.${encodeURIComponent(nowIso)}&order=created_at.desc&limit=1`;
  const cr = await fetch(codeUrl, { headers: sbH() });
  const codes = await cr.json().catch(() => []);
  if (!Array.isArray(codes) || !codes.length) return j(401, { error: 'That code is invalid or expired.' });

  const member = await getMember(email);
  if (!member) return j(403, { error: 'No activated Business Center access found for that email.' });

  const token = 'bc_' + crypto.randomUUID().replace(/-/g, '');
  const session = {
    email: member.email,
    business_name: member.business_name || '',
    uei: '',
    onboarding_state: 'complete',
    account_type: 'bc_member',
    session_token: token,
  };

  // Persist the session server-side so downstream functions (client-pipeline,
  // subscriber-capability, etc.) can actually verify this token against
  // client_sessions instead of trusting whatever the client claims.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/client_sessions`, {
    method: 'POST',
    headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      session_token: token,
      email: member.email,
      uei: '',
      business_name: member.business_name || '',
      account_type: 'bc_member',
      expires_at: expiresAt,
    }),
  }).catch(err => console.error('[verify-member-login-code] session persist failed', err.message));

  const response = j(200, {
    ok: true,
    token,
    session,
    member: {
      id: member.id,
      email: member.email,
      fullName: member.full_name || '',
      businessName: member.business_name || '',
      business_name: member.business_name || '',
      industry: member.industry || '',
      city: member.city || '',
      state: member.state || '',
      memberType: 'bc_member',
    },
  });

  cleanupCodes(email);
  return response;
};
