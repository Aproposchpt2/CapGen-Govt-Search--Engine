'use strict';

const { json, opsGuard, SUPABASE_URL, SUPABASE_KEY, sbHeaders } = require('./lib/ngcc-ops');
const { reconcileResponse, closeoutMission } = require('./lib/ngcc-response-closeout');

async function loadClaims(noticeId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { rows: [], sourceStatus: 'UNAVAILABLE', sourceError: 'NGCC operational database is not configured.' };
  const query = `?source=eq.ngcc_outreach_claim&source_reference=eq.${encodeURIComponent(noticeId)}&select=id,business_name,contact_name,contact_email,source_reference,redirect_url,source,created_at&order=created_at.desc&limit=100`;
  try {
    const response = await fetch(`${String(SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/marketplace_lead_intake${query}`, { headers: sbHeaders() });
    if (!response.ok) {
      const text = await response.text();
      return { rows: [], sourceStatus: 'UNAVAILABLE', sourceError: `Marketplace claim source unavailable (${response.status}): ${text.slice(0, 240)}` };
    }
    return { rows: await response.json(), sourceStatus: 'AVAILABLE', sourceError: null };
  } catch (error) {
    return { rows: [], sourceStatus: 'UNAVAILABLE', sourceError: error.message };
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const opportunity = body.opportunity && typeof body.opportunity === 'object' ? body.opportunity : {};
  const noticeId = String(opportunity.noticeId || opportunity.notice_id || body.notice_id || '').trim();
  const samUrl = String(opportunity.samUrl || opportunity.sam_url || body.sam_url || '').trim();
  const action = String(body.action || 'reconcile').trim().toLowerCase();
  if (!noticeId) return json(400, { ok: false, error: 'A SAM notice ID is required.' });

  let source;
  if (Array.isArray(body.claim_records)) {
    source = { rows: body.claim_records, sourceStatus: 'INJECTED_TEST_EVIDENCE', sourceError: null };
  } else {
    source = await loadClaims(noticeId);
  }

  const reconciliation = reconcileResponse({ noticeId, samUrl, rows: source.rows, sourceStatus: source.sourceStatus, sourceError: source.sourceError });

  if (action === 'reconcile') {
    return json(200, {
      ok: true,
      stage: 'RESPONSE_CONTRACT_ASSISTANCE',
      status: reconciliation.response_count ? 'WAITING' : 'WAITING',
      current_activity: reconciliation.response_count ? 'Response received. Operator handoff/closeout decision required.' : reconciliation.response_source_status === 'AVAILABLE' ? 'Awaiting contractor response.' : 'Response source requires operator review.',
      reconciliation,
      terminal: false,
    });
  }

  if (action !== 'close') return json(400, { ok: false, error: 'action must be reconcile or close.' });

  try {
    const closeout = closeoutMission({ reconciliation, decision: body.decision, operatorNote: body.operator_note });
    return json(200, {
      ok: true,
      stage: 'RESPONSE_CONTRACT_ASSISTANCE',
      status: 'SUCCESS',
      current_activity: 'Mission closeout decision recorded.',
      reconciliation,
      closeout,
      terminal: true,
      records_examined: reconciliation.response_count,
      records_accepted: reconciliation.response_count,
      records_rejected: 0,
    });
  } catch (error) {
    return json(409, { ok: false, stage: 'RESPONSE_CONTRACT_ASSISTANCE', status: 'WAITING', error: error.message, reconciliation });
  }
};
