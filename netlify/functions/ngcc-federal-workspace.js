'use strict';

const {
  sb, safe, verifyWorkspaceToken, loadOutreachById, loadSamOpportunity,
  opportunitySnapshot, publicSamUrl,
} = require('./lib/ngcc-federal-workspace');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) };
}

function resourceLabel(url, index) {
  try {
    const parsed = new URL(url);
    const raw = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return raw && raw.length <= 160 ? raw : `SAM.gov Attachment ${index + 1}`;
  } catch {
    return `SAM.gov Attachment ${index + 1}`;
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'GET only.' });

  const token = safe(event.queryStringParameters?.t);
  const verified = verifyWorkspaceToken(token);
  if (!verified) return json(401, { ok: false, error: 'This federal Opportunity Workspace session is invalid or expired.' });

  try {
    const outreach = await loadOutreachById(verified.outreach_id);
    if (!outreach) return json(404, { ok: false, error: 'The federal opportunity introduction could not be found.' });
    const provider = outreach.provider_payload && typeof outreach.provider_payload === 'object' ? outreach.provider_payload : {};
    if (!provider.claimed_at) return json(403, { ok: false, error: 'This federal opportunity has not been claimed.' });

    let sam = null;
    let refreshWarning = null;
    try { sam = await loadSamOpportunity(outreach.notice_id, provider.posted_date); }
    catch (error) { refreshWarning = error.message; }
    const opportunity = opportunitySnapshot(outreach, sam);
    const resources = (opportunity.resource_links || []).map((url, index) => ({
      number: index + 1,
      label: resourceLabel(url, index),
      source_url: publicSamUrl(url),
    }));

    const now = new Date().toISOString();
    await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, {
      provider_payload: {
        ...provider,
        workspace_first_viewed_at: provider.workspace_first_viewed_at || now,
        workspace_last_viewed_at: now,
        workspace_view_count: Number(provider.workspace_view_count || 0) + 1,
      },
    }, 'return=minimal');

    return json(200, {
      ok: true,
      access: {
        business_name: provider.claimed_business_name || outreach.business_name,
        contact_name: provider.claimed_name || outreach.contact_name,
        expires_at: new Date(verified.exp * 1000).toISOString(),
        claimed_at: provider.claimed_at,
      },
      opportunity: {
        ...opportunity,
        resource_links: undefined,
        package_status: resources.length ? 'PUBLIC_SAM_RESOURCES_AVAILABLE' : opportunity.description_url ? 'PUBLIC_SAM_NOTICE_AVAILABLE' : 'NO_PUBLIC_SAM_PACKAGE_FOUND',
      },
      documents: resources,
      package: {
        public_attachment_count: resources.length,
        description_available: Boolean(opportunity.description_url),
        download_available: Boolean(resources.length || opportunity.description_url),
        verification_status: refreshWarning ? 'SAM_REFRESH_WARNING' : 'CURRENT_NOTICE_REFRESHED',
        warning: refreshWarning,
        note: 'APROPOS packages the public resources available from the current SAM.gov notice. SAM.gov and the issuing agency remain authoritative; restricted or controlled files may require direct SAM.gov access.',
      },
    });
  } catch (error) {
    console.error('[rfcp-federal-workspace]', error);
    return json(500, { ok: false, error: 'The federal Opportunity Workspace could not be loaded.' });
  }
};
