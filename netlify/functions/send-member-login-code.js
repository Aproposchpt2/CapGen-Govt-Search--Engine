'use strict';
// Registered Federal Contractors Portal — returning customer login step 1.
// The merged verified business profile is authoritative. Legacy Business Center
// and direct CapGen customer records remain supported as compatibility fallbacks.

const crypto = require('crypto');
const DEFAULT_SUPABASE_URL = 'https://judislfknmhofcgzyozc.supabase.co';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.BC_SUPA_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BC_SUPA_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.RESEND_FROM_EMAIL || 'Apropos Group LLC <jmitchell@aproposgroupllc.com>';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const GENERIC_ACCEPTED = { ok: true, message: 'If that email is associated with an eligible portal profile or account, an access code has been sent.' };
const j = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const sbH = (extra = {}) => ({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...extra });

function memberIsActive(member) {
  const status = String(member.subscription_status || '').toLowerCase();
  if (['active', 'trial', 'trialing', 'paid', 'comp'].includes(status)) return true;
  const trialEnd = member.trial_end ? Date.parse(member.trial_end) : 0;
  return Number.isFinite(trialEnd) && trialEnd > Date.now();
}

function customerIsActive(customer) {
  const status = String(customer.status || '').toLowerCase();
  if (['active', 'trial'].includes(status)) return true;
  const end = customer.current_period_end ? Date.parse(customer.current_period_end) : 0;
  return Number.isFinite(end) && end > Date.now();
}

async function findVerifiedProfile(email) {
  const select = 'intake_id,business_profile_id,business_email,business_name,contact_name,resident_state,verified_profile,updated_at';
  const url = `${SUPABASE_URL}/rest/v1/natcorp_business_intakes?intake_kind=eq.business_profile&business_email=eq.${encodeURIComponent(email)}&discovery_status=eq.verified&select=${encodeURIComponent(select)}&order=updated_at.desc&limit=1`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows.length) return null;
  return rows[0];
}

async function findActivatedMember(email) {
  const select = 'email,full_name,business_name,industry,city,state,subscription_status,trial_end,bc_access_activated';
  const url = `${SUPABASE_URL}/rest/v1/biz_center_members?email=eq.${encodeURIComponent(email)}&bc_access_activated=eq.true&select=${encodeURIComponent(select)}&limit=1`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows.length) return null;
  return memberIsActive(rows[0]) ? rows[0] : null;
}

async function findDirectCustomer(email) {
  const select = 'email,full_name,business_name,subscription_tier,status,current_period_end,access_activated';
  const url = `${SUPABASE_URL}/rest/v1/capgen_customers?email=eq.${encodeURIComponent(email)}&access_activated=eq.true&select=${encodeURIComponent(select)}&limit=1`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows.length) return null;
  return customerIsActive(rows[0]) ? rows[0] : null;
}

async function findReturningIdentity(email) {
  const profile = await findVerifiedProfile(email);
  if (profile) return { account_type: 'portal_profile', record: profile };
  const member = await findActivatedMember(email);
  if (member) return { account_type: 'bc_member', record: member };
  const customer = await findDirectCustomer(email);
  if (customer) return { account_type: 'capgen_direct', record: customer };
  return null;
}

async function invalidateOutstandingCodes(email) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/capgen_member_login_codes?email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: sbH({ Prefer: 'return=minimal' }),
  });
  if (!r.ok) throw new Error('Existing login codes could not be invalidated.');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { error: 'POST only' });
  if (!SERVICE_KEY) return j(500, { error: 'Supabase service key is not configured.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return j(400, { error: 'Invalid JSON' }); }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return j(400, { error: 'A valid email is required.' });

  const identity = await findReturningIdentity(email);
  if (!identity) return j(200, GENERIC_ACCEPTED);

  const code = String(crypto.randomInt(100000, 1000000));
  const expires_at = new Date(Date.now() + 10 * 60000).toISOString();
  try {
    await invalidateOutstandingCodes(email);
  } catch (e) {
    console.error('[send-member-login-code]', e.message);
    return j(502, { error: 'Login code could not be issued.' });
  }

  const codeWrite = await fetch(`${SUPABASE_URL}/rest/v1/capgen_member_login_codes`, {
    method: 'POST',
    headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ email, code, expires_at }),
  });
  if (!codeWrite.ok) return j(502, { error: 'Login code could not be issued.' });

  const html = `<div style="background:#06111d;padding:34px 16px;font-family:Arial,sans-serif"><div style="max-width:460px;margin:0 auto;background:#0F2A6A;border:1px solid #1c3878;border-radius:10px;padding:32px;text-align:center">
    <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#C9A84C;margin-bottom:14px">Registered Federal Contractors Portal</div>
    <p style="color:#dbe8ff;font-size:14px;margin:0 0 18px">Your login code:</p>
    <div style="font-size:34px;letter-spacing:.32em;font-weight:800;color:#fff;background:#07111f;border:2px solid #C9A84C;border-radius:10px;padding:18px;margin-bottom:18px">${code}</div>
    <p style="color:#dbe8ff;font-size:13px;line-height:1.6">Enter this code to access your Federal + State Contract Dashboard. It expires in 10 minutes.</p>
    <p style="color:#7890b5;font-size:11px;margin-top:20px">A service of Apropos Group LLC</p></div></div>`;

  if (RESEND_KEY) {
    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject: `Your portal login code: ${code}`, html }),
    }).catch((e) => ({ ok: false, text: async () => e.message }));
    if (!mail.ok) {
      const detail = await mail.text().catch(() => 'unknown email delivery error');
      console.error('[send-member-login-code] email delivery failed:', String(detail).slice(0, 300));
      await invalidateOutstandingCodes(email).catch(() => {});
      return j(502, { error: 'Login code could not be sent.' });
    }
  } else {
    await invalidateOutstandingCodes(email).catch(() => {});
    return j(500, { error: 'Email delivery is not configured.' });
  }

  return j(200, GENERIC_ACCEPTED);
};
