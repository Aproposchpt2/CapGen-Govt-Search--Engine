'use strict';
// Reference-build OTP sender.
// POST { email } -> stores a short-lived OTP in Supabase and emails it through Resend.

const crypto = require('crypto');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Apropos Group LLC <jmitchell@aproposgroupllc.com>';
const ACCESS_EMAIL = String(process.env.REFERENCE_ACCESS_EMAIL || process.env.RESEND_TO_EMAIL || '')
  .trim()
  .toLowerCase();
const OTP_MINUTES = 15;

function json(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function generateOTP() {
  return String(crypto.randomInt(100000, 1000000));
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

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[pipeline-otp-send] Missing SUPABASE_URL or Supabase service key.');
    return json(500, { error: 'Access service is not configured.' });
  }
  if (!RESEND_KEY) {
    console.error('[pipeline-otp-send] Missing RESEND_API_KEY.');
    return json(500, { error: 'Email service is not configured.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Valid email required.' });
  }

  // This branch is a controlled historical-reference build, not public production.
  if (!ACCESS_EMAIL) {
    console.error('[pipeline-otp-send] REFERENCE_ACCESS_EMAIL or RESEND_TO_EMAIL is not configured.');
    return json(500, { error: 'Reference access is not configured.' });
  }
  if (email !== ACCESS_EMAIL) {
    return json(403, { error: 'This reference build is restricted to the authorized review email.' });
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60 * 1000).toISOString();

  try {
    const deleteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_otp?email=eq.${encodeURIComponent(email)}&used=eq.false`,
      { method: 'DELETE', headers: supabaseHeaders({ Prefer: 'return=minimal' }) },
    );
    if (!deleteRes.ok) {
      const detail = await deleteRes.text().catch(() => '');
      console.warn('[pipeline-otp-send] Prior OTP cleanup failed:', deleteRes.status, detail.slice(0, 240));
    }

    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_otp`, {
      method: 'POST',
      headers: supabaseHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify({ email, code, expires_at: expiresAt, used: false }),
    });

    if (!saveRes.ok) {
      const detail = await saveRes.text().catch(() => '');
      console.error('[pipeline-otp-send] OTP insert failed:', saveRes.status, detail.slice(0, 500));
      return json(500, { error: 'Could not generate code. Try again.' });
    }
  } catch (error) {
    console.error('[pipeline-otp-send] Supabase request failed:', error.message);
    return json(500, { error: 'Could not generate code. Try again.' });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: 'Your NGCC Reference Access Code',
        html: `
          <div style="font-family:Arial,sans-serif;background:#0A1A3A;padding:40px 20px;min-height:100vh;">
            <div style="max-width:440px;margin:0 auto;background:#0f2244;border:1px solid rgba(91,175,255,.25);border-radius:18px;padding:36px 32px;">
              <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#5BD3FF;font-weight:700;">National Government Contract Center</p>
              <h2 style="margin:0 0 16px;font-size:22px;color:#f0f6ff;">Your reference access code</h2>
              <p style="margin:0 0 24px;font-size:14px;color:#8facd0;line-height:1.7;">Enter this code to review the June 10 NGCC Analyze Fit implementation.</p>
              <div style="background:#07111f;border:2px solid #5BD3FF;border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;">
                <div style="font-size:11px;color:#5a7899;letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px;font-family:monospace;">Access Code</div>
                <div style="font-size:3rem;font-weight:900;letter-spacing:.22em;color:#5BD3FF;font-family:monospace;">${code}</div>
              </div>
              <p style="margin:0;font-size:12px;color:#5a7899;line-height:1.6;">This code expires in ${OTP_MINUTES} minutes.</p>
            </div>
          </div>`,
      }),
    });

    if (!emailRes.ok) {
      const detail = await emailRes.text().catch(() => '');
      console.error('[pipeline-otp-send] Resend failed:', emailRes.status, detail.slice(0, 500));
      return json(500, { error: 'Could not send code. Try again.' });
    }
  } catch (error) {
    console.error('[pipeline-otp-send] Email request failed:', error.message);
    return json(500, { error: 'Could not send code. Try again.' });
  }

  return json(200, { ok: true });
};
