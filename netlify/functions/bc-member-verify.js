'use strict';
// Verifies a Business Center member by email + capgen_access_code.
// Required Netlify env vars: BC_SUPA_URL/SUPABASE_URL and BC_SUPA_KEY/SUPABASE_SERVICE_ROLE_KEY.

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const { fullName, businessName, email, accessCode } = JSON.parse(event.body || '{}');
  if (!email || !accessCode) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and access code required' }) };

  const SUPA = (process.env.BC_SUPA_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const SKEY = process.env.BC_SUPA_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!SUPA || !SKEY) return {
    statusCode: 500,
    headers,
    body: JSON.stringify({ ok: false, error: 'Business Center member verification is not configured.' }),
  };

  const r = await fetch(
    `${SUPA}/rest/v1/biz_center_members?email=eq.${encodeURIComponent(email.toLowerCase().trim())}&select=id,full_name,email,business_name,industry,city,state,business_stage,readiness_score,subscription_status,trial_end,capgen_access_code`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } }
  );

  const data = await r.json().catch(() => []);
  const member = data && data[0];

  if (!member) return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: false, error: 'No Business Center membership found for this email. Join at aibizcenter.aproposgroupllc.com' }),
  };

  if ((member.capgen_access_code || '').toUpperCase().trim() !== accessCode.toUpperCase().trim()) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: 'Invalid access code. Check your Business Center welcome email.' }),
    };
  }

  const status = String(member.subscription_status || '').toLowerCase();
  const trialEnd = new Date(member.trial_end);
  const now = new Date();
  const isActive = ['active', 'trialing', 'trial', 'paid', 'comp'].includes(status) || trialEnd > now;

  if (!isActive) return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: false, error: 'Your Business Center membership is inactive. Renew at aibizcenter.aproposgroupllc.com/subscription.html' }),
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      member: {
        email: member.email,
        fullName: member.full_name || fullName || '',
        businessName: member.business_name || businessName || '',
        industry: member.industry,
        city: member.city,
        state: member.state,
        businessStage: member.business_stage,
        readinessScore: member.readiness_score,
        accessLevel: 'full',
        memberType: 'bc_member',
      },
    }),
  };
};
