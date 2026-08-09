// NGCC — Internal operator authentication for the non-public-facing
// outreach tool (/ops-outreach.html). Single shared operator password
// (NGCC_OPS_PASSWORD), distinct from the subscriber OTP login used by
// onboarding.html/dashboard — this page is not customer-facing.
'use strict';
const { json, sameOrigin, verifyOpsSession, issueOpsSession, OPS_PASSWORD } = require('./lib/ngcc-ops');

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return json(200, { ok: verifyOpsSession(event) });
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST or GET only.' });
  if (!sameOrigin(event)) return json(403, { ok: false, error: 'Same-origin request required.' });
  if (!OPS_PASSWORD) return json(500, { ok: false, error: 'NGCC_OPS_PASSWORD is not configured.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
  const password = String(body.password || '');
  if (password !== OPS_PASSWORD) return json(401, { ok: false, error: 'Incorrect password.' });

  return json(200, { ok: true, ...issueOpsSession() });
};
