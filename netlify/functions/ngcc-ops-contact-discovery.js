'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { discoverSelectedContacts } = require('./lib/ngcc-contact-discovery');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const selected = candidates.filter(candidate => candidate.operator_selected === true || candidate.operator_disposition === 'APPROVED');
  if (!selected.length) {
    return json(409, {
      ok: false,
      stage: 'CONTACT_DISCOVERY',
      status: 'BLOCKED',
      error: 'Operator must explicitly select at least one ranked candidate before contact discovery.'
    });
  }

  try {
    const { results, summary } = await discoverSelectedContacts(selected, { limit: body.limit || 10 });
    return json(200, {
      ok: true,
      stage: 'CONTACT_DISCOVERY',
      status: results.length ? 'SUCCESS' : 'ZERO_RESULT',
      records_examined: selected.length,
      records_accepted: summary.VERIFIED || 0,
      records_rejected: (summary.NOT_FOUND || 0) + (summary.FAILED || 0),
      summary,
      contacts: results,
      policy: 'Only operator-selected candidates are searched. Positive contact results require a verifiable public email plus source URL. No guessed addresses are permitted.',
      next_gate: 'Operator must separately approve verified contacts before Stage 07 outreach.'
    });
  } catch (error) {
    console.error('[ngcc-ops-contact-discovery]', error);
    return json(200, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'FAILED', error: String(error?.message || error) });
  }
};
