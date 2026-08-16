'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { selectApprovedOutreachContacts, toLegacyOutreachCandidate } = require('./lib/ngcc-outreach-control');
const outreachService = require('./ngcc-ops-outreach');

// Stage 07 is an operator-controlled draft gate. This endpoint validates the
// selected/verified recipients and PREPARES drafts only. It never transmits
// email. The Command Center must subsequently save and explicitly send each
// draft through ngcc-ops-outreach action=send.
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
      error: 'Operator must explicitly approve at least one QUALIFIED contractor with a VERIFIED public email and source evidence before outreach preparation.',
    });
  }

  const nestedEvent = {
    ...event,
    httpMethod: 'POST',
    body: JSON.stringify({
      action: 'prepare',
      contract,
      candidates: approved.map(toLegacyOutreachCandidate),
    }),
  };

  const response = await outreachService.handler(nestedEvent);
  let payload;
  try { payload = JSON.parse(response.body || '{}'); }
  catch { payload = { ok: false, error: 'Outreach preparation response was not valid JSON.' }; }

  if (response.statusCode >= 400 || payload.ok === false) return response;
  return json(200, {
    ok: true,
    stage: 'BUSINESS_OUTREACH',
    status: 'WAITING',
    approved_contacts: approved.length,
    ...payload,
    control_policy: 'Draft preparation sends nothing. The operator reviews, edits, saves, and explicitly approves each prospective-client email. Production send then emails the business and separately notifies the operator.',
  });
};
