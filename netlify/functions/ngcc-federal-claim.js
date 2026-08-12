'use strict';

const {
  RESEND_KEY, RESEND_FROM, TEST_RECIPIENT,
} = require('./lib/ngcc-ops');
const {
  sb, safe, normalize, claimReference, issueWorkspaceToken,
  loadOutreachForClaim, loadSamOpportunity, opportunitySnapshot,
} = require('./lib/ngcc-federal-workspace');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) };
}

async function notifyOperator({ outreach, name, businessName, email, reference, workspaceExpiresAt }) {
  if (!RESEND_KEY || !TEST_RECIPIENT) return;
  const text = [
    `Business: ${businessName}`,
    `Contact: ${name}`,
    `Email: ${email}`,
    `Opportunity reference: ${reference}`,
    `SAM.gov notice: ${outreach.notice_id}`,
    `SAM.gov URL: ${outreach.contract_sam_url || 'Unavailable'}`,
    `Workspace access expires: ${workspaceExpiresAt}`,
    `Source: ngcc_outreach_claim`,
  ].join('\n');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [TEST_RECIPIENT],
      subject: `Federal opportunity claimed: ${businessName}`,
      text,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) console.error('[ngcc-federal-claim] operator notification failed:', response.status, await response.text().catch(() => ''));
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const noticeId = safe(body.notice_id || body.source_reference);
  const name = safe(body.name || body.contact_name);
  const businessName = safe(body.business_name);
  const email = safe(body.email || body.contact_email).toLowerCase();
  const reference = safe(body.opportunity_reference).toUpperCase();

  if (!noticeId || !name || !businessName || !email || !reference) {
    return json(400, { ok: false, error: 'Name, business name, business email, Opportunity Reference, and SAM.gov notice are required.' });
  }
  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: 'A valid business email is required.' });

  try {
    const outreach = await loadOutreachForClaim(noticeId, email);
    if (!outreach) return json(404, { ok: false, error: 'This complimentary federal opportunity could not be verified for that business email.' });
    if (!['sent', 'delivered', 'replied'].includes(String(outreach.status || '').toLowerCase())) {
      return json(409, { ok: false, error: 'This opportunity introduction is not currently available for claim.' });
    }
    if (normalize(businessName) !== normalize(outreach.business_name)) {
      return json(403, { ok: false, error: 'The business name does not match the original opportunity introduction.' });
    }
    const expectedReference = claimReference(noticeId, email);
    if (reference !== expectedReference) return json(403, { ok: false, error: 'The Opportunity Reference does not match this opportunity introduction.' });

    const currentPayload = outreach.provider_payload && typeof outreach.provider_payload === 'object' ? outreach.provider_payload : {};
    if (currentPayload.claimed_at) {
      return json(409, { ok: false, error: 'This complimentary federal opportunity has already been claimed. Use the Opportunity Workspace opened during the original claim.' });
    }

    const workspace = issueWorkspaceToken(outreach.outreach_id);
    let sam = null;
    try { sam = await loadSamOpportunity(noticeId, currentPayload.posted_date); }
    catch (error) { console.warn('[ngcc-federal-claim] SAM refresh warning:', error.message); }
    const opportunity = opportunitySnapshot(outreach, sam);
    const claimedAt = new Date().toISOString();

    const claimRows = await sb('marketplace_lead_intake', 'POST', '', [{
      business_name: businessName,
      contact_name: name,
      contact_email: email,
      source_reference: noticeId,
      redirect_url: opportunity.sam_url || outreach.contract_sam_url,
      source: 'ngcc_outreach_claim',
    }], 'return=representation');

    await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, {
      status: 'replied',
      provider_payload: {
        ...currentPayload,
        claim_reference: expectedReference,
        claimed_at: claimedAt,
        claimed_name: name,
        claimed_business_name: businessName,
        claimed_email: email,
        claimed_via: 'APROPOS_FEDERAL_OPPORTUNITY_WORKSPACE',
        workspace_access_issued_at: claimedAt,
        workspace_access_expires_at: workspace.expires_at,
        marketplace_claim_id: claimRows?.[0]?.id || null,
      },
    }, 'return=minimal');

    try { await notifyOperator({ outreach, name, businessName, email, reference: expectedReference, workspaceExpiresAt: workspace.expires_at }); }
    catch (error) { console.error('[ngcc-federal-claim] notifyOperator:', error.message); }

    return json(200, {
      ok: true,
      workspace_token: workspace.token,
      expires_at: workspace.expires_at,
      business_name: businessName,
      opportunity,
    });
  } catch (error) {
    console.error('[ngcc-federal-claim]', error);
    return json(500, { ok: false, error: 'The complimentary federal opportunity claim could not be completed.' });
  }
};
