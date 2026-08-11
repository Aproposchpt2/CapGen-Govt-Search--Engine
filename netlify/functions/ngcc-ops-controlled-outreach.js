'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { selectApprovedOutreachContacts, toLegacyOutreachCandidate } = require('./lib/ngcc-outreach-control');
const legacyOutreach = require('./ngcc-ops-outreach');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const contract = body.contract && typeof body.contract === 'object' ? body.contract : {};
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const approved = selectApprovedOutreachContacts(contacts);

  if (!approved.length) {
    return json(409, {
      ok: false,
      stage: 'BUSINESS_OUTREACH',
      status: 'BLOCKED',
      error: 'Operator must explicitly approve at least one VERIFIED contact with source evidence before outreach.'
    });
  }

  const nestedEvent = {
    ...event,
    httpMethod: 'POST',
    body: JSON.stringify({
      contract,
      candidates: approved.map(toLegacyOutreachCandidate),
    }),
  };

  const response = await legacyOutreach.handler(nestedEvent);
  let payload;
  try { payload = JSON.parse(response.body || '{}'); }
  catch { payload = { ok: false, error: 'Legacy outreach response was not valid JSON.' }; }

  if (response.statusCode >= 400 || payload.ok === false) return response;
  return json(200, {
    ok: true,
    stage: 'BUSINESS_OUTREACH',
    status: 'SUCCESS',
    approved_contacts: approved.length,
    ...payload,
    control_policy: 'Only operator-approved, publicly verified contacts with source evidence are eligible for outreach. Existing NGCC suppression, idempotency, per-candidate failure isolation, and TEST MODE controls remain authoritative.'
  });
};
