'use strict';
// Registered Federal Contractors Portal — returning customer login step 2.
// The merged verified business profile is authoritative. Legacy Business Center
// and direct CapGen customer records remain supported as compatibility fallbacks.

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
  return r.ok && Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findActivatedMember(email) {
  const select = 'id,email,full_name,business_name,industry,city,state,subscription_status,trial_end,bc_access_activated';
  const url = `${SUPABASE_URL}/rest/v1/biz_center_members?email=eq.${encodeURIComponent(email)}&bc_access_activated=eq.true&select=${encodeURIComponent(select)}&limit=1`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows.length) return null;
  return memberIsActive(rows[0]) ? rows[0] : null;
}

async function findDirectCustomer(email) {
  const select = 'id,email,full_name,business_name,uei,state,subscription_tier,status,current_period_end,access_activated';
  const url = `${SUPABASE_URL}/rest/v1/capgen_customers?email=eq.${encodeURIComponent(email)}&access_activated=eq.true&select=${encodeURIComponent(select)}&limit=1`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows.length) return null;
  return customerIsActive(rows[0]) ? rows[0] : null;
}

async function findReturningIdentity(email) {
  const profile = await findVerifiedProfile(email);
  if (profile) {
    const verified = profile.verified_profile || {};
    return {
      account_type: 'portal_profile',
      id: profile.business_profile_id || profile.intake_id,
      email: profile.business_email || email,
      full_name: profile.contact_name || '',
      business_name: verified.business_name || verified.legal_name || profile.business_name || '',
      uei: verified.uei || '',
      industry: '', city: '', state: verified.resident_state || profile.resident_state || '',
    };
  }

  const member = await findActivatedMember(email);
  if (member) return { account_type: 'bc_member', ...member, uei: '' };

  const customer = await findDirectCustomer(email);
  if (customer) return { account_type: 'capgen_direct', ...customer, industry: '', city: '' };

  return null;
}

function cleanupCodes(email) {
  fetch(`${SUPABASE_URL}/rest/v1/capgen_member_login_codes?email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE', headers: sbH({ Prefer: 'return=minimal' }),
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
  if (!cr.ok || !Array.isArray(codes) || !codes.length) return j(401, { error: 'That code is invalid or expired.' });

  const identity = await findReturningIdentity(email);
  if (!identity) return j(403, { error: 'No verified portal profile or activated legacy account found for that email.' });

  const prefix = identity.account_type === 'portal_profile' ? 'portal_' : identity.account_type === 'capgen_direct' ? 'cg_' : 'bc_';
  const token = prefix + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const sessionWrite = await fetch(`${SUPABASE_URL}/rest/v1/client_sessions`, {
    method: 'POST',
    headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      session_token: token,
      email: identity.email,
      uei: identity.uei || '',
      business_name: identity.business_name || '',
      account_type: identity.account_type,
      expires_at: expiresAt,
      revoked: false,
    }),
  });
  if (!sessionWrite.ok) return j(502, { error: 'Customer session could not be created.' });

  cleanupCodes(email);

  const session = {
    email: identity.email,
    business_name: identity.business_name || '',
    uei: identity.uei || '',
    onboarding_state: 'complete',
    account_type: identity.account_type,
    session_token: token,
  };

  return j(200, {
    ok: true,
    token,
    session,
    member: {
      id: identity.id || null,
      email: identity.email,
      fullName: identity.full_name || '',
      businessName: identity.business_name || '',
      business_name: identity.business_name || '',
      industry: identity.industry || '',
      city: identity.city || '',
      state: identity.state || '',
      memberType: identity.account_type,
    },
  });
};
