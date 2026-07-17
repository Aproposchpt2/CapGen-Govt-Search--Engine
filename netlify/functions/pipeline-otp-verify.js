'use strict';
// Reference-build OTP verifier.
// POST { email, code } -> validates OTP and returns the legacy session shape expected by onboarding.html.

const crypto = require('crypto');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || '';
const ACCESS_EMAIL = String(process.env.REFERENCE_ACCESS_EMAIL || process.env.RESEND_TO_EMAIL || '')
  .trim()
  .toLowerCase();

function json(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  if (!SUPABASE_URL || !SERVICE_KEY || !AUTH_TOKEN_SECRET) {
    console.error('[pipeline-otp-verify] Missing Supabase credentials or AUTH_TOKEN_SECRET.');
    return json(500, { error: 'Access verification is not configured.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return json(400, { error: 'Email and 6-digit code required.' });
  }
  if (!ACCESS_EMAIL || email !== ACCESS_EMAIL) {
    return json(403, { error: 'This reference build is restricted to the authorized review email.' });
  }

  let row;
  try {
    const otpRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_otp?email=eq.${encodeURIComponent(email)}&code=eq.${encodeURIComponent(code)}&used=eq.false&order=created_at.desc&limit=1`,
      { headers: supabaseHeaders() },
    );

    if (!otpRes.ok) {
      const detail = await otpRes.text().catch(() => '');
      console.error('[pipeline-otp-verify] OTP lookup failed:', otpRes.status, detail.slice(0, 500));
      return json(500, { error: 'Could not verify code. Try again.' });
    }

    const rows = await otpRes.json();
    if (!Array.isArray(rows) || !rows.length) {
      return json(401, { error: 'Incorrect code. Please try again.' });
    }
    row = rows[0];
  } catch (error) {
    console.error('[pipeline-otp-verify] OTP lookup request failed:', error.message);
    return json(500, { error: 'Could not verify code. Try again.' });
  }

  if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
    return json(401, { error: 'Code expired. Request a new one.' });
  }

  try {
    const usedRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_otp?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: supabaseHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify({ used: true }),
    });
    if (!usedRes.ok) {
      const detail = await usedRes.text().catch(() => '');
      console.error('[pipeline-otp-verify] OTP mark-used failed:', usedRes.status, detail.slice(0, 500));
      return json(500, { error: 'Could not complete verification. Try again.' });
    }
  } catch (error) {
    console.error('[pipeline-otp-verify] OTP update request failed:', error.message);
    return json(500, { error: 'Could not complete verification. Try again.' });
  }

  let account = {};
  try {
    const accountRes = await fetch(
      `${SUPABASE_URL}/rest/v1/capgen_subscriptions?email=eq.${encodeURIComponent(email)}&select=uei,business_name,naics,onboarding_state,status&limit=1`,
      { headers: supabaseHeaders() },
    );
    if (accountRes.ok) {
      const rows = await accountRes.json();
      if (Array.isArray(rows) && rows[0]) account = rows[0];
    } else {
      const detail = await accountRes.text().catch(() => '');
      console.warn('[pipeline-otp-verify] Account lookup failed:', accountRes.status, detail.slice(0, 240));
    }
  } catch (error) {
    console.warn('[pipeline-otp-verify] Account lookup request failed:', error.message);
  }

  const ts = Date.now();
  const toSign = JSON.stringify({ email, ts });
  const sig = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(toSign).digest('hex');
  const token = Buffer.from(JSON.stringify({ email, ts, sig })).toString('base64');

  return json(200, {
    ok: true,
    token,
    email,
    uei: account.uei || '',
    business_name: account.business_name || '',
    naics: account.naics || '',
    onboarding_state: account.onboarding_state || 'complete',
    status: account.status || '',
  });
};
