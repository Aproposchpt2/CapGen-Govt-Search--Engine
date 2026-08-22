// RFCP — live federal contract matching for a verified business profile.
// Registered Federal Contractors Portal merge, 2026-08-16.
//
// The upstream federal source is queried server-side. Customer-facing payloads
// deliberately do not expose upstream opportunity URLs; selection remains
// inside the Apropos Federal Contract Workspace.
import { json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';
import { searchSamOpportunities, samDeadline } from './lib/ngcc-sam-opportunities.js';

const MAX_NAICS = 8;
const PER_CODE_LIMIT = 25;

function opportunityView(row, matchedNaics) {
  return {
    inventory_source: 'federal',
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
    match: {
      source: 'Federal (SAM.gov-derived opportunity record)',
      contractor_capability: `Confirmed contractor NAICS ${matchedNaics}`,
      basis: 'sam_derived_naics',
      evidence: { contractor_naics: matchedNaics, opportunity_naics: row.naicsCode || null },
      limitations: ['NAICS alignment is an initial discovery signal, not proof of scope, eligibility, capacity, or package completeness.'],
    },
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
        data_source: { relation: 'Official federal public records (queried live server-side)' },
        note: 'No authoritative NAICS classifications were confirmed on this profile, so Federal NAICS matching cannot run until server verification is complete.',
      });
    }

    const perCode = await Promise.all(naicsCodes.map(async (code) => {
      try {
        const result = await searchSamOpportunities({ naicsCode: code, activeOnly: true, limit: PER_CODE_LIMIT, defaultDays: 120 });
        return result.rows.map((row) => opportunityView(row, code));
      } catch (error) {
        console.error('[rfcp-federal-matches] naics', code, error.message);
        return [];
      }
    }));

    const byNotice = new Map();
    for (const row of perCode.flat()) {
      const key = row.notice_id || row.solicitation_number;
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
      data_source: { relation: 'Official federal public records (queried live server-side)' },
    });
  } catch (error) {
    console.error('[rfcp-federal-matches]', error);
    return json(500, { ok: false, error: error instanceof Error ? error.message : 'Federal contract matching failed.' });
  }
}

export const config = {
  path: '/api/federal-matches',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
