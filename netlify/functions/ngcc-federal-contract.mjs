import { json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';
import { searchSamOpportunities, samDeadline } from './lib/ngcc-sam-opportunities.js';

function safe(value) { return String(value ?? '').trim(); }

function sanitizeOpportunity(row) {
  return {
    notice_id: row.noticeId || row.solicitationNumber || null,
    title: row.title || 'Untitled opportunity',
    agency: row.fullParentPathName || row.department || row.subTier || row.organizationType || 'Federal agency',
    solicitation_number: row.solicitationNumber || null,
    naics_code: row.naicsCode || null,
    notice_type: row.type || null,
    set_aside: row.typeOfSetAsideDescription || row.typeOfSetAside || null,
    posted_at: row.postedDate || null,
    response_deadline: samDeadline(row),
    active: row.active,
    place_of_performance: row.placeOfPerformance || null,
    description_available: Boolean(row.description),
    public_attachment_count: Array.isArray(row.resourceLinks) ? row.resourceLinks.length : 0,
  };
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'GET') return json(405, { ok: false, error: 'GET only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });
    if (session.discovery_status !== 'verified') return json(409, { ok: false, error: 'Verify your business profile before opening contract details.' });

    const requestUrl = new URL(req.url);
    const noticeId = safe(requestUrl.searchParams.get('id'));
    if (!noticeId) return json(400, { ok: false, error: 'Contract notice ID is required.' });

    const result = await searchSamOpportunities({ noticeId, activeOnly: false, limit: 5, defaultDays: 365 });
    const row = result.rows.find(item => safe(item.noticeId) === noticeId) || result.rows[0];
    if (!row) return json(404, { ok: false, error: 'This federal contract is no longer available from the upstream public record.' });

    return json(200, {
      ok: true,
      contract: sanitizeOpportunity(row),
      package: {
        available: Boolean(row.description || (Array.isArray(row.resourceLinks) && row.resourceLinks.length)),
        download_url: `/api/federal-contract-package?id=${encodeURIComponent(noticeId)}`,
      },
      provenance: { source_type: 'official federal public record', retained_internally: true },
    });
  } catch (error) {
    console.error('[ngcc-federal-contract]', error);
    return json(500, { ok: false, error: 'The federal contract workspace could not be loaded.' });
  }
}

export const config = {
  path: '/api/federal-contract',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
