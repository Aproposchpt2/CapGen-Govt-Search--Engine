// RFCP internal operator authentication. The historical environment-variable
// names are retained as technical aliases. This credential is distinct from
// the contractor sign-in used by
// onboarding.html/dashboard — this page is not customer-facing.
'use strict';
const crypto = require('crypto');
const {
  json,
  sameOrigin,
  verifyOpsSessionDetails,
  issueOpsSession,
  OPS_PASSWORD,
  TEST_OPS_PASSWORD,
  TEST_OPS_EXPIRES_AT,
} = require('./lib/ngcc-ops');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validTestExpiry() {
  const timestamp = Date.parse(TEST_OPS_EXPIRES_AT);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const session = verifyOpsSessionDetails(event);
    return json(200, { ok: Boolean(session), ...(session || {}) });
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST or GET only.' });
  if (!sameOrigin(event)) return json(403, { ok: false, error: 'Same-origin request required.' });
  if (!OPS_PASSWORD && !TEST_OPS_PASSWORD) {
    return json(500, { ok: false, error: 'RFCP operator authentication is not configured.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
  if (body.action === 'logout') {
    return json(200, { ok: true }, { 'Set-Cookie': 'rfcp_ops=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  const password = String(body.password || '');
  if (OPS_PASSWORD && safeEqual(password, OPS_PASSWORD)) {
    const session = issueOpsSession({ role: 'operator' });
    const maxAge = Math.max(0, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000));
    return json(200, { ok: true, ...session }, { 'Set-Cookie': `rfcp_ops=${encodeURIComponent(session.token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` });
  }

  if (TEST_OPS_PASSWORD && safeEqual(password, TEST_OPS_PASSWORD)) {
    if (!validTestExpiry()) return json(401, { ok: false, error: 'Temporary test access has expired or is not active.' });
    const session = issueOpsSession({ role: 'test_operator', expiresAt: TEST_OPS_EXPIRES_AT });
    const maxAge = Math.max(0, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000));
    return json(200, { ok: true, ...session }, { 'Set-Cookie': `rfcp_ops=${encodeURIComponent(session.token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` });
  }

  return json(401, { ok: false, error: 'Incorrect password.' });
};
