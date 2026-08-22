'use strict';

// RFCP opportunity outreach follows the proven BusinessContracts operator
// control pattern: PREPARE DRAFT -> REVIEW/EDIT -> SAVE -> APPROVE & SEND.
// Nothing in draft preparation transmits email. A real business email is sent
// only after an authenticated operator explicitly invokes action=send.
const {
  json, opsGuard, sbHeaders, SUPABASE_URL, sha256Hex, RESEND_KEY, RESEND_FROM,
  TEST_RECIPIENT, MAILING_ADDRESS,
} = require('./lib/ngcc-ops');

const OPERATOR_NOTIFICATION_RECIPIENT = process.env.OPERATOR_NOTIFICATION_EMAIL || TEST_RECIPIENT;
const UNSUBSCRIBE_COPY = 'To unsubscribe from future opportunity introductions, use the UNSUBSCRIBE button at the end of this email.';
const PRODUCTION_SEND = true && String(process.env.NGCC_OUTREACH_DELIVERY_MODE || 'test').trim().toLowerCase() === 'production';

async function sb(table, method, query, body, prefer) {
  const headers = { ...sbHeaders() };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query || ''}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table} ${method} ${res.status}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const clean = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function claimReference(contract, candidate) {
  return `NG-${sha256Hex(`${contract.noticeId}|${clean(candidate.contact_email).toLowerCase()}`).slice(0, 8).toUpperCase()}`;
}

const RFCP_CLAIM_FRONT_DOOR = 'https://federalcontractorportal.aproposgroupllc.com/claim.html';

function claimUrl(contract, candidate, reference) {
  const params = new URLSearchParams({
    ref: reference || claimReference(contract, candidate),
  });
  return `${RFCP_CLAIM_FRONT_DOOR}?${params.toString()}`;
}

function normalizeOutreachText(bodyText, unsubscribeUrl) {
  let text = clean(bodyText);
  if (unsubscribeUrl) text = text.split(unsubscribeUrl).join('');
  text = text
    .replace(/Unsubscribe from future opportunity introductions:\s*/gi, `${UNSUBSCRIBE_COPY}\n`)
    .replace(/To unsubscribe from future opportunity introductions, use the UNSUBSCRIBE button(?: at the end of this email| in this email)?\.?/gi, UNSUBSCRIBE_COPY)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text.toLowerCase().includes('unsubscribe from future opportunity introductions')) {
    text = `${text}\n\n${UNSUBSCRIBE_COPY}`.trim();
  }
  return text;
}

function editableOutreachHtml(bodyText, unsubscribeUrl, claimLink) {
  const safeBody = esc(bodyText);
  const claimButton = claimLink
    ? `<div style="margin:26px 0;text-align:left"><a href="${esc(claimLink)}" style="display:inline-block;background:#0F2A6A;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700">OPEN IN RFCP</a></div>`
    : '';
  const unsubscribeButton = unsubscribeUrl
    ? `<div style="border-top:1px solid #e4e8ee;padding-top:18px;margin-top:24px;text-align:center"><a href="${esc(unsubscribeUrl)}" style="display:inline-block;background:#667085;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:12px;font-weight:800;letter-spacing:.04em">UNSUBSCRIBE</a></div>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#EEF1F7;font-family:Arial,sans-serif;color:#172033"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;background:#fff;border:1px solid #dbe1ec;border-radius:14px;overflow:hidden"><tr><td style="background:#0F2A6A;padding:24px 28px;color:#fff;border-bottom:3px solid #D5AE55"><div style="font-weight:700;letter-spacing:.08em;font-size:13px">REGISTERED FEDERAL CONTRACTORS PORTAL · RFCP</div><div style="font-size:12px;color:#dbe5ff;margin-top:4px">Apropos Group LLC</div></td></tr><tr><td style="padding:28px;white-space:pre-line;line-height:1.58">${safeBody}${claimButton}${unsubscribeButton}</td></tr></table></td></tr></table></body></html>`;
}

function outreachCopy(contract, candidate, unsubscribeUrl, reference) {
  const deadline = contract.responseDeadline
    ? new Date(contract.responseDeadline).toLocaleDateString('en-US', { dateStyle: 'long' })
    : 'See official solicitation';
  const subject = `Federal contract opportunity for ${candidate.business_name}: ${contract.title}`;
  const claimLink = claimUrl(contract, candidate, reference);
  const text = normalizeOutreachText(`Hello${candidate.contact_name ? ` ${candidate.contact_name}` : ''},

Apropos Group LLC is a proactive procurement agency. Our automated system identifies qualified businesses whose services match contract requirements.

We discovered your company while sourcing businesses for this opportunity.

WHY YOUR BUSINESS WAS SELECTED
Your SAM.gov registration includes industry classifications aligned with this federal contract opportunity. Matching NAICS: ${contract.naicsCode || 'See opportunity details'}.

Opportunity: ${contract.title}
Agency: ${contract.agency || 'Unavailable'}
Solicitation: ${contract.solicitationNumber || 'Unavailable'}
NAICS: ${contract.naicsCode || 'Unavailable'}
Response deadline: ${deadline}

Claim Your Complimentary Contract Opportunity

APROPOS has identified this contract opportunity for your business.

Open the secure RFCP claim page below and enter your business information.

Opportunity Reference: ${reference}

If you are interested, click the link below to visit our website and download the complete contract package.

This service is complimentary—no purchase is required. You are also welcome to leave a comment or ask a question.

Good luck!

Registered Federal Contractors Portal
Apropos Group LLC
${MAILING_ADDRESS}

${UNSUBSCRIBE_COPY}`, unsubscribeUrl);
  return {
    subject,
    text,
    html: editableOutreachHtml(text, unsubscribeUrl, claimLink),
    claimLink,
  };
}

async function loadOutreach(outreachId) {
  const rows = await sb('ngcc_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*`);
  const outreach = rows?.[0];
  if (!outreach) throw new Error('Outreach draft not found.');
  return outreach;
}

async function listOutreach(noticeId) {
  if (!clean(noticeId)) return [];
  return (await sb('ngcc_outreach_events', 'GET', `?notice_id=eq.${encodeURIComponent(noticeId)}&select=*&order=created_at.asc`)) || [];
}

async function generateOutreach(contract, candidate) {
  const email = clean(candidate.contact_email).toLowerCase();
  if (!email) throw new Error('A verified public contact email is required before outreach preparation.');
  const suppressed = await sb('unsubscribe_suppressions', 'GET', `?email_hash=eq.${encodeURIComponent(sha256Hex(email))}&select=id`);
  if (suppressed?.length) throw new Error('This email is suppressed from future outreach.');

  const existing = await sb(
    'ngcc_outreach_events',
    'GET',
    `?notice_id=eq.${encodeURIComponent(contract.noticeId)}&contact_email=eq.${encodeURIComponent(email)}&select=*&order=created_at.desc&limit=1`
  );
  const prior = existing?.[0];
  if (prior && prior.status === 'sent') return prior;

  const unsubToken = sha256Hex(`unsub.${email}.${process.env.AUTH_TOKEN_SECRET}`);
  const unsubscribeUrl = `https://federalcontractorportal.aproposgroupllc.com/.netlify/functions/ngcc-unsubscribe?email=${encodeURIComponent(email)}&t=${unsubToken}`;
  const reference = claimReference(contract, candidate);
  const copy = outreachCopy(contract, candidate, unsubscribeUrl, reference);
  const providerPayload = {
    ...(prior?.provider_payload || {}),
    email_html: copy.html,
    unsubscribe_url: unsubscribeUrl,
    marketplace_claim_url: copy.claimLink,
    claim_reference: reference,
    solicitation_number: contract.solicitationNumber || null,
    posted_date: contract.postedDate || null,
    resource_links: Array.isArray(contract.resourceLinks) ? contract.resourceLinks : [],
    sam_description_url: contract.descriptionUrl || contract.description || null,
    additional_info_url: contract.additionalInfoLink || null,
    candidate_id: candidate.candidate_id || null,
    search_run_id: candidate.search_run_id || null,
    qualification_rank: candidate.qualification_rank ?? candidate.rank ?? null,
    qualification_score: candidate.qualification_score ?? candidate.contract_qualification_score ?? null,
    qualification_status: candidate.qualification_status || null,
    contact_source_url: candidate.contact_source_url || candidate.source_url || null,
    operator_notification_status: 'PENDING',
    source_snapshot: {
      notice_id: contract.noticeId,
      solicitation_number: contract.solicitationNumber || null,
      title: contract.title,
      agency: contract.agency || null,
      naics: contract.naicsCode || null,
      deadline: contract.responseDeadline || null,
      sam_url: contract.samUrl,
    },
  };

  const row = {
    notice_id: contract.noticeId,
    contract_title: contract.title,
    contract_agency: contract.agency,
    contract_naics: contract.naicsCode,
    contract_deadline: contract.responseDeadline,
    contract_sam_url: contract.samUrl,
    business_name: candidate.business_name,
    contact_name: candidate.contact_name || null,
    contact_email: email,
    uei_sam: candidate.ueiSAM || candidate.uei || null,
    subject: copy.subject,
    body_text: copy.text,
    status: 'draft',
    provider_message_id: null,
    sent_at: null,
    provider_payload: providerPayload,
    updated_at: new Date().toISOString(),
  };

  if (prior) {
    const updated = await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(prior.outreach_id)}`, row, 'return=representation');
    return updated?.[0];
  }
  const created = await sb('ngcc_outreach_events', 'POST', '', [row], 'return=representation');
  return created?.[0];
}

async function saveOutreach(outreachId, subject, requestedBodyText) {
  const outreach = await loadOutreach(outreachId);
  if (outreach.status === 'sent') throw new Error('A sent outreach message cannot be edited.');
  if (outreach.status === 'canceled') throw new Error('A canceled outreach message cannot be edited.');
  const cleanSubject = clean(subject);
  const requested = clean(requestedBodyText);
  if (!cleanSubject || !requested) throw new Error('Subject and email message are required.');
  const unsubscribeUrl = clean(outreach.provider_payload?.unsubscribe_url);
  const claimLink = clean(outreach.provider_payload?.marketplace_claim_url);
  const bodyText = normalizeOutreachText(requested, unsubscribeUrl);
  const html = editableOutreachHtml(bodyText, unsubscribeUrl, claimLink);
  const updated = await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, {
    subject: cleanSubject,
    body_text: bodyText,
    status: 'draft',
    provider_payload: {
      ...(outreach.provider_payload || {}),
      email_html: html,
      operator_edited: true,
      operator_edited_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, 'return=representation');
  return updated?.[0];
}

async function sendOperatorNotification(outreach) {
  if (!OPERATOR_NOTIFICATION_RECIPIENT) throw new Error('Operator notification recipient is not configured.');
  const reference = outreach.provider_payload?.claim_reference || 'Unavailable';
  const claimLink = outreach.provider_payload?.marketplace_claim_url || 'Unavailable';
  const text = `RFCP opportunity outreach sent.\n\nBusiness: ${outreach.business_name || 'Unavailable'}\nContact: ${outreach.contact_name || 'Unavailable'}\nRecipient: ${outreach.contact_email || 'Unavailable'}\nContract: ${outreach.contract_title || 'Unavailable'}\nAgency: ${outreach.contract_agency || 'Unavailable'}\nOpportunity Reference: ${reference}\n\nClaim URL:\n${claimLink}\n\nThis notification confirms that the approved opportunity introduction was sent to the prospective client.`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [OPERATOR_NOTIFICATION_RECIPIENT],
      subject: `RFCP outreach sent: ${outreach.business_name || 'prospective client'}`,
      text,
      reply_to: OPERATOR_NOTIFICATION_RECIPIENT,
      tags: [
        { name: 'service', value: 'ngcc' },
        { name: 'mode', value: 'production_notice' },
        { name: 'outreach_id', value: clean(outreach.outreach_id).replaceAll('-', '').slice(0, 32) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Operator notification Resend ${response.status}`);
  return data;
}

async function sendOutreach(outreachId) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY is not configured.');
  if (!PRODUCTION_SEND && !TEST_RECIPIENT) throw new Error('Controlled test delivery recipient is not configured.');
  let outreach = await loadOutreach(outreachId);

  // Idempotency: once the prospective-client message is sent, never send it
  // again just because the separate operator notification needs a retry.
  if (outreach.status !== 'sent') {
    if (!outreach.contact_email) throw new Error('Recipient email is unavailable.');
    if (!['draft', 'failed'].includes(outreach.status)) throw new Error(`Outreach status ${outreach.status} is not sendable.`);
    const suppressed = await sb('unsubscribe_suppressions', 'GET', `?email_hash=eq.${encodeURIComponent(sha256Hex(outreach.contact_email.toLowerCase()))}&select=id`);
    if (suppressed?.length) throw new Error('This email is suppressed from future outreach.');

    const deliveryRecipient = PRODUCTION_SEND ? outreach.contact_email : TEST_RECIPIENT;
    const clientResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [deliveryRecipient],
        subject: outreach.subject,
        text: outreach.body_text,
        html: outreach.provider_payload?.email_html,
        reply_to: OPERATOR_NOTIFICATION_RECIPIENT || undefined,
        tags: [
          { name: 'service', value: 'ngcc' },
          { name: 'mode', value: PRODUCTION_SEND ? 'production' : 'controlled_test' },
          { name: 'outreach_id', value: clean(outreach.outreach_id).replaceAll('-', '').slice(0, 32) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const clientData = await clientResponse.json().catch(() => ({}));
    if (!clientResponse.ok) {
      await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, {
        status: 'failed',
        provider_payload: { ...(outreach.provider_payload || {}), send_error: clientData },
        updated_at: new Date().toISOString(),
      }, 'return=minimal');
      throw new Error(clientData.message || `Prospective-client email Resend ${clientResponse.status}`);
    }

    const updated = await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, {
      status: 'sent',
      provider_message_id: clientData.id || null,
      sent_at: new Date().toISOString(),
      provider_payload: {
        ...(outreach.provider_payload || {}),
        resend: clientData,
        production_send: PRODUCTION_SEND,
        delivery_mode: PRODUCTION_SEND ? 'production' : 'controlled_test',
        intended_recipient: outreach.contact_email,
        delivered_recipient: deliveryRecipient,
        operator_notification_recipient: OPERATOR_NOTIFICATION_RECIPIENT || null,
        operator_notification_status: 'PENDING',
      },
      updated_at: new Date().toISOString(),
    }, 'return=representation');
    outreach = updated?.[0] || outreach;
  }

  let operatorNotificationSent = outreach.provider_payload?.operator_notification_status === 'SENT';
  let operatorNotificationError = null;
  if (!operatorNotificationSent) {
    try {
      const operatorData = await sendOperatorNotification(outreach);
      const updated = await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, {
        provider_payload: {
          ...(outreach.provider_payload || {}),
          operator_notification_status: 'SENT',
          operator_notification_resend: operatorData,
          operator_notification_error: null,
        },
        updated_at: new Date().toISOString(),
      }, 'return=representation');
      outreach = updated?.[0] || outreach;
      operatorNotificationSent = true;
    } catch (error) {
      operatorNotificationError = error.message;
      const updated = await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, {
        provider_payload: {
          ...(outreach.provider_payload || {}),
          operator_notification_status: 'FAILED',
          operator_notification_error: operatorNotificationError,
        },
        updated_at: new Date().toISOString(),
      }, 'return=representation');
      outreach = updated?.[0] || outreach;
    }
  }

  return {
    outreach,
    prospective_client_sent: outreach.status === 'sent',
    operator_notification_sent: operatorNotificationSent,
    operator_notification_error: operatorNotificationError,
    production_mode: PRODUCTION_SEND,
  };
}

async function prepareOutreach(contract, candidates) {
  const results = [];
  const drafts = [];
  for (const candidate of candidates) {
    const label = candidate.business_name || candidate.contact_email || 'candidate';
    if (!candidate.contact_email) {
      results.push({ business_name: label, outcome: 'SKIPPED_NO_EMAIL' });
      continue;
    }
    try {
      const draft = await generateOutreach(contract, candidate);
      drafts.push(draft);
      results.push({
        business_name: label,
        outcome: draft.status === 'sent' ? 'ALREADY_SENT' : 'DRAFT_READY',
        outreach_id: draft.outreach_id,
      });
    } catch (error) {
      results.push({ business_name: label, outcome: 'FAILED', error: error.message });
    }
  }
  const summary = results.reduce((acc, result) => {
    acc.total += 1;
    acc[result.outcome] = (acc[result.outcome] || 0) + 1;
    return acc;
  }, { total: 0 });
  return { summary, results, drafts, production_mode: PRODUCTION_SEND };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;

  try {
    if (event.httpMethod === 'GET') {
      const noticeId = clean(event.queryStringParameters?.notice_id);
      if (!noticeId) return json(400, { ok: false, error: 'notice_id is required.' });
      const outreach = await listOutreach(noticeId);
      return json(200, { ok: true, outreach, production_mode: PRODUCTION_SEND });
    }
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
    const action = clean(body.action || 'prepare').toLowerCase();

    if (action === 'save') {
      const outreachId = clean(body.outreach_id);
      if (!outreachId) return json(400, { ok: false, error: 'outreach_id is required.' });
      const outreach = await saveOutreach(outreachId, body.subject, body.body_text);
      return json(200, { ok: true, action: 'save', outreach, status: 'DRAFT_SAVED' });
    }

    if (action === 'send' || action === 'notify') {
      const outreachId = clean(body.outreach_id);
      if (!outreachId) return json(400, { ok: false, error: 'outreach_id is required.' });
      const result = await sendOutreach(outreachId);
      return json(200, {
        ok: true,
        action,
        status: result.operator_notification_sent ? 'SENT' : 'SENT_NOTIFICATION_WARNING',
        ...result,
      });
    }

    if (action !== 'prepare') return json(400, { ok: false, error: `Unsupported outreach action: ${action}` });
    const contract = body.contract || {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!contract.noticeId || !contract.title || !contract.samUrl) {
      return json(400, { ok: false, error: 'contract.noticeId, contract.title, and contract.samUrl are required.' });
    }
    if (!candidates.length) return json(400, { ok: false, error: 'No candidates were selected.' });
    const prepared = await prepareOutreach(contract, candidates);
    return json(200, {
      ok: true,
      action: 'prepare',
      stage: 'BUSINESS_OUTREACH',
      status: 'WAITING',
      message: `${prepared.drafts.filter(item => item.status !== 'sent').length} outreach draft(s) ready for operator review. No email was sent by draft preparation.`,
      ...prepared,
    });
  } catch (error) {
    console.error('[rfcp-ops-outreach]', error.message);
    return json(500, { ok: false, error: error.message });
  }
};

module.exports.normalizeOutreachText = normalizeOutreachText;
module.exports.editableOutreachHtml = editableOutreachHtml;
module.exports.outreachCopy = outreachCopy;
module.exports.prepareOutreach = prepareOutreach;
module.exports.saveOutreach = saveOutreach;
module.exports.sendOutreach = sendOutreach;
module.exports.PRODUCTION_SEND = PRODUCTION_SEND;
