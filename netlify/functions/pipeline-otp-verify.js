'use strict';
// RFC Portal returning-member compatibility endpoint.
// The customer-facing onboarding page historically calls pipeline-otp-verify.
// Delegate verification/session creation to the authoritative merged-profile
// handler while preserving the legacy flat response shape the dashboard reads.

const { handler: verifyReturningMemberCode } = require('./verify-member-login-code.js');

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const delegated = await verifyReturningMemberCode(event);
  let payload = {};
  try { payload = JSON.parse(delegated.body || '{}'); } catch { payload = {}; }

  if (delegated.statusCode !== 200 || !payload.ok) {
    return {
      statusCode: delegated.statusCode,
      headers: { ...HEADERS, ...(delegated.headers || {}) },
      body: delegated.body || JSON.stringify({ error: 'Unable to verify access code.' }),
    };
  }

  const session = payload.session || {};
  const sessionToken = payload.token || session.session_token || '';
  if (!sessionToken) {
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Customer session could not be created.' }) };
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ok: true,
      session_token: sessionToken,
      email: session.email || '',
      uei: session.uei || '',
      business_name: session.business_name || '',
      onboarding_state: session.onboarding_state || 'complete',
      account_type: session.account_type || 'portal_profile',
      member: payload.member || null,
    }),
  };
};
