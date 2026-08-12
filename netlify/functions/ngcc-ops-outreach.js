// NGCC ops — the email piece: generate + send the opportunity introduction
// to selected SAM-registered contractors, in bulk, in one action.
// Reuses the isolate/preserve/continue + idempotency pattern shipped for
// BusinessContracts' bulk_send_outreach: one failure doesn't abort the
// batch, and a candidate already sent for this notice_id is skipped.
//
// TEST MODE (on by default): every send routes to RESEND_TO_EMAIL (the
// operator's own inbox), never the real business. Flip only after explicit
// confirmation — this sends real cold email to real third parties.
'use strict';
const {
  json, opsGuard, sbHeaders, SUPABASE_URL, sha256Hex, RESEND_KEY, RESEND_FROM,
  TEST_RECIPIENT, MAILING_ADDRESS,
} = require('./lib/ngcc-ops');

const TEST_MODE = true;

async function sb(table, method, query, body, prefer) {
  const headers = { ...sbHeaders() };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query || ''}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase ${table} ${method} ${res.status}: ${t.slice(0, 300)}`); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function claimReference(contract, candidate) {
  return `NG-${sha256Hex(`${contract.noticeId}|${String(candidate.contact_email || '').trim().toLowerCase()}`).slice(0, 8).toUpperCase()}`;
}

function claimUrl(contract, candidate, reference) {
  const params = new URLSearchParams({
    notice_id: contract.noticeId || '',
    sam_url: contract.samUrl || '',
    title: contract.title || '',
    agency: contract.agency || '',
    solicitation: contract.solicitationNumber || '',
    ref: reference || claimReference(contract, candidate),
  });
  return `https://marketplace.aproposgroupllc.com/claim-federal-opportunity?${params.toString()}`;
}

function outreachCopy(contract, candidate, unsubscribeUrl, reference) {
  const deadline = contract.responseDeadline ? new Date(contract.responseDeadline).toLocaleDateString('en-US', { dateStyle: 'long' }) : 'See official solicitation';
  const subject = `Federal contract opportunity for ${candidate.business_name}: ${contract.title}`;
  const claimLink = claimUrl(contract, candidate, reference);
  const text = `Hello${candidate.contact_name ? ` ${candidate.contact_name}` : ''},

The National Government Contract Center identified a federal contract opportunity that appears relevant to ${candidate.business_name}, based on your SAM.gov registration (NAICS ${contract.naicsCode || 'Unavailable'}).

Opportunity: ${contract.title}
Agency: ${contract.agency || 'Unavailable'}
NAICS: ${contract.naicsCode || 'Unavailable'}
Response deadline: ${deadline}
Opportunity Reference: ${reference}

Claim this complimentary opportunity to open your secure APROPOS Opportunity Workspace. The workspace provides the current public SAM.gov opportunity resources APROPOS can retrieve, together with the official SAM.gov source link:
${claimLink}

SAM.gov and the issuing agency remain authoritative. Restricted or controlled files may require direct access through SAM.gov or the issuing agency.

Unsubscribe from future opportunity introductions:
${unsubscribeUrl}

National Government Contract Center
Apropos Group LLC
${MAILING_ADDRESS}`;
  const html = `<!doctype html><html><body style="margin:0;background:#EEF1F7;font-family:Arial,sans-serif;color:#0F2A6A"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #dbe1ec;border-radius:14px;overflow:hidden"><tr><td style="background:#0F2A6A;padding:24px 28px;color:#fff;border-bottom:3px solid #D5AE55"><div style="font-weight:700;letter-spacing:.08em;font-size:13px">NATIONAL GOVERNMENT CONTRACT CENTER</div></td></tr><tr><td style="padding:28px"><p>Hello${candidate.contact_name ? ` ${esc(candidate.contact_name)}` : ''},</p><p>NGCC identified a federal contract opportunity that appears relevant to <strong>${esc(candidate.business_name)}</strong>, based on your SAM.gov registration (NAICS ${esc(contract.naicsCode || 'Unavailable')}).</p><div style="background:#F5F7FB;border-left:4px solid #D5AE55;padding:16px;margin:20px 0"><div style="font-size:18px;font-weight:700;color:#0F2A6A">${esc(contract.title)}</div><p style="margin:8px 0 0"><strong>Agency:</strong> ${esc(contract.agency || 'Unavailable')}<br><strong>NAICS:</strong> ${esc(contract.naicsCode || 'Unavailable')}<br><strong>Deadline:</strong> ${esc(deadline)}<br><strong>Opportunity Reference:</strong> ${esc(reference)}</p></div><p style="margin:26px 0"><a href="${claimLink}" style="display:inline-block;background:#0F2A6A;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700">Claim This Complimentary Opportunity</a></p><p style="font-size:13px;color:#667085;line-height:1.55">After claiming, you will enter a secure APROPOS Opportunity Workspace with the current public SAM.gov resources APROPOS can retrieve and a direct link to the authoritative SAM.gov notice. Restricted or controlled files may still require direct SAM.gov or issuing-agency access.</p><p style="margin-top:30px">National Government Contract Center<br>Apropos Group LLC</p><p style="border-top:1px solid #e4e8ee;padding-top:14px;font-size:11px;color:#667085">${esc(MAILING_ADDRESS)}<br><a href="${unsubscribeUrl}" style="color:#667085">Unsubscribe</a></p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, claimLink };
}

async function generateOutreach(contract, candidate) {
  const suppressed = await sb('unsubscribe_suppressions', 'GET', `?email_hash=eq.${encodeURIComponent(sha256Hex(candidate.contact_email.toLowerCase()))}&select=id`);
  if (suppressed?.length) throw new Error('This email is suppressed from future outreach.');
  const unsubToken = sha256Hex(`unsub.${candidate.contact_email.toLowerCase()}.${process.env.AUTH_TOKEN_SECRET}`);
  const unsubscribeUrl = `https://ngcc.aproposgroupllc.com/.netlify/functions/ngcc-unsubscribe?email=${encodeURIComponent(candidate.contact_email)}&t=${unsubToken}`;
  const reference = claimReference(contract, candidate);
  const copy = outreachCopy(contract, candidate, unsubscribeUrl, reference);
  const created = await sb('ngcc_outreach_events', 'POST', '', [{
    notice_id: contract.noticeId, contract_title: contract.title, contract_agency: contract.agency,
    contract_naics: contract.naicsCode, contract_deadline: contract.responseDeadline, contract_sam_url: contract.samUrl,
    business_name: candidate.business_name, contact_name: candidate.contact_name || null, contact_email: candidate.contact_email.toLowerCase(),
    uei_sam: candidate.ueiSAM || null, subject: copy.subject, body_text: copy.text, status: 'draft',
    provider_payload: {
      email_html: copy.html,
      unsubscribe_url: unsubscribeUrl,
      marketplace_claim_url: copy.claimLink,
      claim_reference: reference,
      solicitation_number: contract.solicitationNumber || null,
      posted_date: contract.postedDate || null,
      resource_links: Array.isArray(contract.resourceLinks) ? contract.resourceLinks : [],
      sam_description_url: contract.descriptionUrl || contract.description || null,
      additional_info_url: contract.additionalInfoLink || null,
      source_snapshot: {
        notice_id: contract.noticeId,
        solicitation_number: contract.solicitationNumber || null,
        title: contract.title,
        agency: contract.agency || null,
        naics: contract.naicsCode || null,
        deadline: contract.responseDeadline || null,
        sam_url: contract.samUrl,
      },
    },
  }], 'return=representation');
  return created?.[0];
}

async function sendOutreach(outreachId) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const rows = await sb('ngcc_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*`);
  const outreach = rows?.[0];
  if (!outreach) throw new Error('Outreach record not found.');
  if (outreach.status === 'sent') return outreach;
  const testBanner = TEST_MODE ? `[TEST MODE — intended recipient: ${outreach.contact_email}]\n\n` : '';
  const payload = {
    from: RESEND_FROM,
    to: [TEST_MODE ? TEST_RECIPIENT : outreach.contact_email],
    subject: TEST_MODE ? `[TEST] ${outreach.subject}` : outreach.subject,
    text: testBanner + outreach.body_text,
    html: outreach.provider_payload?.email_html,
    reply_to: TEST_RECIPIENT || undefined,
  };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, { status: 'failed', provider_payload: { ...outreach.provider_payload, send_error: data } }, 'return=minimal');
    throw new Error(data.message || `Resend ${res.status}`);
  }
  const updated = await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, { status: 'sent', provider_message_id: data.id || null, sent_at: new Date().toISOString(), provider_payload: { ...outreach.provider_payload, resend: data, test_mode: TEST_MODE, intended_production_recipient: outreach.contact_email } }, 'return=representation');
  return updated?.[0];
}

async function bulkSendOutreach(contract, candidates) {
  const results = [];
  for (const candidate of candidates) {
    const label = candidate.business_name || candidate.contact_email;
    if (!candidate.contact_email) { results.push({ business_name: label, outcome: 'SKIPPED_NO_EMAIL' }); continue; }
    try {
      const existing = await sb('ngcc_outreach_events', 'GET', `?notice_id=eq.${encodeURIComponent(contract.noticeId)}&contact_email=eq.${encodeURIComponent(candidate.contact_email.toLowerCase())}&select=outreach_id,status&order=created_at.desc&limit=1`);
      const prior = existing?.[0];
      if (prior && ['sent', 'delivered', 'replied'].includes(prior.status)) { results.push({ business_name: label, outcome: 'ALREADY_SENT', outreach_id: prior.outreach_id }); continue; }
      const outreachId = prior?.outreach_id || (await generateOutreach(contract, candidate)).outreach_id;
      const sent = await sendOutreach(outreachId);
      results.push({ business_name: label, outcome: 'SENT', outreach_id: sent?.outreach_id || outreachId });
    } catch (error) {
      results.push({ business_name: label, outcome: 'FAILED', error: error.message });
    }
  }
  const summary = results.reduce((s, r) => { s.total++; s[r.outcome] = (s[r.outcome] || 0) + 1; return s; }, { total: 0 });
  return { summary, results, test_mode: TEST_MODE };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
  const contract = body.contract || {};
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (!contract.noticeId || !contract.title || !contract.samUrl) return json(400, { ok: false, error: 'contract.noticeId, contract.title, and contract.samUrl are required.' });
  if (!candidates.length) return json(400, { ok: false, error: 'No candidates were selected.' });

  try {
    const result = await bulkSendOutreach(contract, candidates);
    return json(200, { ok: true, ...result });
  } catch (error) {
    console.error('[ngcc-ops-outreach]', error.message);
    return json(500, { ok: false, error: error.message });
  }
};
