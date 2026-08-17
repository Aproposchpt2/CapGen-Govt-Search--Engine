// NGCC — live federal contract matching for a verified business profile.
// Registered Federal Contractors Portal merge, 2026-08-16.
//
// Deliberately NOT a stored/synced table like the state pipeline (NV/AZ/CA
// scrapers -> state_contract_opportunities). SAM.gov's own Contract
// Opportunities API is itself the authoritative, current, sortable/searchable
// federal source -- there is nothing to acquire or keep fresh ourselves. This
// queries SAM.gov live, scoped to the profile's own NAICS codes, on every
// dashboard load. If/when NGCC has real subscribers, a caching/storage layer
// can be added without changing this contract; not needed to ship correctly.
import { json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';
import { searchSamOpportunities, samDeadline } from './lib/ngcc-sam-opportunities.js';

const MAX_NAICS = 8;
const PER_CODE_LIMIT = 25;

function opportunityView(row, matchedNaics) {
  return {
    notice_id: row.noticeId || row.solicitationNumber || null,
    title: row.title || 'Untitled opportunity',
    agency: row.fullParentPathName || row.department || row.subTier || row.organizationType || 'Federal agency',
    solicitation_number: row.solicitationNumber || null,
    naics_code: row.naicsCode || matchedNaics,
    matched_naics: matchedNaics,
    notice_type: row.type || null,
    set_aside: row.typeOfSetAsideDescription || row.typeOfSetAside || null,
    posted_at: row.postedDate || null,
    response_deadline: samDeadline(row),
    active: row.active,
    place_of_performance_state: row.placeOfPerformance?.state?.code || null,
    description_url: row.description || null,
    ui_link: row.uiLink || (row.noticeId ? `https://sam.gov/opp/${row.noticeId}/view` : null),
  };
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });
    if (session.discovery_status !== 'verified') return json(409, { ok: false, error: 'Verify your business profile before searching federal contract matches.' });

    const verified = session.verified_profile || {};
    const naicsCodes = [...new Set((verified.naics_codes || []).filter(Boolean))].slice(0, MAX_NAICS);
    if (!naicsCodes.length) {
      return json(200, {
        ok: true,
        results: [],
        naics_codes: [],
        data_source: { relation: 'Federal Contract Opportunities system (official public records, live)' },
        note: 'No NAICS classifications were confirmed on this profile yet, so no federal matching can run. Edit your profile to add NAICS candidates.',
      });
    }

    const perCode = await Promise.all(naicsCodes.map(async (code) => {
      try {
        const result = await searchSamOpportunities({ naicsCode: code, activeOnly: true, limit: PER_CODE_LIMIT, defaultDays: 120 });
        return result.rows.map((row) => opportunityView(row, code));
      } catch (error) {
        console.error('[ngcc-federal-matches] naics', code, error.message);
        return [];
      }
    }));

    const byNotice = new Map();
    for (const row of perCode.flat()) {
      const key = row.notice_id || row.solicitation_number || row.ui_link;
      if (!key) continue;
      const existing = byNotice.get(key);
      if (existing) { existing.matched_naics = [...new Set([...([].concat(existing.matched_naics)), row.matched_naics])]; continue; }
      byNotice.set(key, { ...row, matched_naics: [row.matched_naics] });
    }

    const results = [...byNotice.values()].sort((a, b) => {
      const ad = a.response_deadline ? new Date(a.response_deadline).getTime() : Infinity;
      const bd = b.response_deadline ? new Date(b.response_deadline).getTime() : Infinity;
      return ad - bd;
    });

    return json(200, {
      ok: true,
      results,
      naics_codes: naicsCodes,
      data_source: { relation: 'Federal Contract Opportunities system (official public records, live)' },
    });
  } catch (error) {
    console.error('[ngcc-federal-matches]', error);
    return json(500, { ok: false, error: error instanceof Error ? error.message : 'Federal contract matching failed.' });
  }
}

export const config = {
  path: '/api/federal-matches',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
