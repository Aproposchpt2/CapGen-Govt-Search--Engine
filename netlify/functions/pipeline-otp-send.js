'use strict';
// RFC Portal returning-member compatibility endpoint.
// The customer-facing onboarding page historically calls pipeline-otp-send.
// Keep that route stable, but delegate all identity resolution, cryptographic
// OTP issuance, and merged-portal email delivery to the authoritative handler.

const { handler: sendReturningMemberCode } = require('./send-member-login-code.js');

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const delegated = await sendReturningMemberCode(event);
  let payload = {};
  try { payload = JSON.parse(delegated.body || '{}'); } catch { payload = {}; }

  // Do not disclose whether a submitted email belongs to a verified profile or
  // legacy account. For syntactically valid requests the outward response is
  // identical whether or not an OTP was actually sent.
  if (delegated.statusCode === 200 && payload.ok) {
    return response(200, {
      ok: true,
      message: 'If that email is associated with an eligible portal profile or account, an access code has been sent.'
    });
  }

  // Preserve genuine request/configuration failures (invalid JSON/email,
  // unavailable backing services) rather than disguising operational errors.
  return {
    statusCode: delegated.statusCode,
    headers: { ...HEADERS, ...(delegated.headers || {}) },
    body: delegated.body || JSON.stringify({ error: 'Unable to process login request.' }),
  };
};
