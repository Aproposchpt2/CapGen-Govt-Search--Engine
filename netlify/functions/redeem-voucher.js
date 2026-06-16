'use strict';
// redeem-voucher.js — POST { code, first_name, last_name, email, business_name, phone, uei }
// Redeems a Commander voucher into a full Operator subscription for the redeemer.
// The redeemed sub is a child of the Commander account (parent_account_id) so it
// deactivates when the Commander plan is canceled.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbH(extra) { return Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}); }
function enc(v) { return encodeURIComponent(v); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').toLowerCase()); }
async function sbGet(path) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbH() }); return r.ok ? r.json() : []; }
function j(code, obj) { return { statusCode: code, headers, body: JSON.stringify(obj) }; }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return j(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'Invalid JSON' }); }

  const code  = String(body.code || '').trim().toUpperCase();
  const email = String(body.email || '').trim().toLowerCase();
  const profile = {
    first_name:    String(body.first_name || '').trim(),
    last_name:     String(body.last_name || '').trim(),
    business_name: String(body.business_name || '').trim(),
    phone:         String(body.phone || '').trim(),
    uei:           String(body.uei || '').trim() || null,
  };
  if (!code || !email || !profile.first_name || !profile.business_name) return j(400, { error: 'Code, name, email, and business name are required.' });
  if (!isEmail(email)) return j(400, { error: 'Enter a valid email address.' });

  // 1. Voucher must exist and be unredeemed
  const vrows = await sbGet(`capgen_vouchers?code=eq.${enc(code)}&select=id,parent_account_id,tier_granted,status&limit=1`);
  const v = Array.isArray(vrows) && vrows[0];
  if (!v) return j(404, { error: 'INVALID_CODE', message: 'That code was not found.' });
  if (v.status !== 'unredeemed') return j(409, { error: 'ALREADY_REDEEMED', message: 'That code has already been used.' });

  // 2. The sponsoring Commander plan must still be active
  const prows = await sbGet(`capgen_subscriptions?id=eq.${enc(v.parent_account_id)}&select=status&limit=1`);
  if (!prows[0] || prows[0].status !== 'active') return j(409, { error: 'PLAN_INACTIVE', message: 'The Commander plan behind this code is no longer active.' });

  // 3. Atomically claim the voucher (guards against double-redeem races)
  const claim = await fetch(`${SUPABASE_URL}/rest/v1/capgen_vouchers?code=eq.${enc(code)}&status=eq.unredeemed`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=representation' }),
    body: JSON.stringify({ status: 'redeemed', redeemed_by_email: email, redeemed_at: new Date().toISOString() }),
  });
  const claimed = claim.ok ? await claim.json() : [];
  if (!Array.isArray(claimed) || !claimed.length) return j(409, { error: 'ALREADY_REDEEMED', message: 'That code has already been used.' });

  // 4. Upsert the redeemer's subscription — full Operator, child of the Commander account
  const subFields = {
    first_name: profile.first_name, last_name: profile.last_name, business_name: profile.business_name,
    phone: profile.phone, uei: profile.uei,
    subscription_tier: v.tier_granted || 'operator', status: 'active',
    parent_account_id: v.parent_account_id, onboarding_state: 'entity_pending',
    updated_at: new Date().toISOString(),
  };
  const existing = await sbGet(`capgen_subscriptions?email=eq.${enc(email)}&select=id&limit=1`);
  let subId = existing[0] && existing[0].id;
  if (subId) {
    await fetch(`${SUPABASE_URL}/rest/v1/capgen_subscriptions?email=eq.${enc(email)}`, {
      method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(subFields),
    });
  } else {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/capgen_subscriptions`, {
      method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
      body: JSON.stringify(Object.assign({ email, plan_type: 'monthly' }, subFields)),
    });
    const rows = ins.ok ? await ins.json() : [];
    subId = rows[0] && rows[0].id;
    if (!subId) console.error('[redeem] sub create failed:', ins.status, (await ins.text?.() || ''));
  }

  // 5. Link the voucher to the activated subscription
  if (subId) {
    await fetch(`${SUPABASE_URL}/rest/v1/capgen_vouchers?code=eq.${enc(code)}`, {
      method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ redeemed_subscription_id: subId }),
    });
  }

  return j(200, { ok: true, email, message: 'Redeemed! Sign in with your email to access your dashboard.' });
};
