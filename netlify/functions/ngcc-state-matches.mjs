// NGCC — state contract matching for a verified business profile, reusing the
// state_contract_opportunities table already populated by the Procurement
// Warehouse acquisition pipeline (CA/NV/AZ scrapers) in this repo's shared
// Supabase project. Registered Federal Contractors Portal merge, 2026-08-16.
//
// This is a plain NAICS-overlap (falling back to keyword) query against
// already-released rows -- not NAT-CORP's AI fit-scoring/explanation engine
// (aoie-state-shadow), which is specific to NAT-CORP's own APIE relationship
// and wasn't built for NGCC. Kept intentionally simple: the profile's NAICS
// codes and procurement terms are the match surface, same fields the federal
// side uses, so one profile drives both without two matching philosophies.
import { db, json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

const RELEASE_FILTER = 'natcorp_release_status=eq.eligible&is_latest_version=eq.true&status=eq.open';
const SELECT = 'select=id,title,description,agency:issuing_organization,solicitation_number:solicitation_number,state_code,jurisdiction_name,place_of_performance_county,naics_codes,procurement_type,response_deadline,posted_at,source_url,official_source_url,acquisition_method';

function pgArrayLiteral(values) {
  return `{${values.map((v) => String(v).replace(/[{}",]/g, '')).join(',')}}`;
}

async function queryByNaics(naicsCodes) {
  if (!naicsCodes.length) return [];
  const filter = `naics_codes=ov.${pgArrayLiteral(naicsCodes)}`;
  return db('state_contract_opportunities', 'GET', `?${RELEASE_FILTER}&${filter}&${SELECT}&order=response_deadline.asc.nullslast&limit=150`) || [];
}

async function queryByKeyword(terms) {
  const usable = terms.filter((t) => t && t.length >= 3).slice(0, 6);
  if (!usable.length) return [];
  const or = usable.map((term) => `title.ilike.*${encodeURIComponent(term)}*`).join(',');
  return db('state_contract_opportunities', 'GET', `?${RELEASE_FILTER}&or=(${or})&${SELECT}&order=response_deadline.asc.nullslast&limit=100`) || [];
}

function matchReason(row, naicsCodes) {
  const overlap = (row.naics_codes || []).filter((code) => naicsCodes.includes(code));
  if (overlap.length) return { basis: 'naics', detail: `Matched on NAICS ${overlap.join(', ')}` };
  return { basis: 'keyword', detail: 'Matched on procurement-term keyword search (no direct NAICS overlap).' };
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });
    if (session.discovery_status !== 'verified') return json(409, { ok: false, error: 'Verify your business profile before searching state contract matches.' });

    const verified = session.verified_profile || {};
    const naicsCodes = [...new Set((verified.naics_codes || []).filter(Boolean))];
    const terms = [...new Set([...(verified.procurement_terms || []), ...(verified.keywords || [])])];

    const [naicsRows, keywordRows] = await Promise.all([
      queryByNaics(naicsCodes),
      naicsCodes.length ? Promise.resolve([]) : queryByKeyword(terms),
    ]);

    const byId = new Map();
    for (const row of naicsRows) byId.set(row.id, row);
    if (!byId.size) for (const row of keywordRows) byId.set(row.id, row);

    const results = [...byId.values()].map((row) => ({
      internal_id: row.id,
      title: row.title,
      agency: row.agency,
      solicitation_number: row.solicitation_number,
      state_code: row.state_code,
      jurisdiction_name: row.jurisdiction_name,
      place_of_performance_county: row.place_of_performance_county,
      procurement_type: row.procurement_type,
      response_deadline: row.response_deadline,
      posted_at: row.posted_at,
      source_url: row.official_source_url || row.source_url,
      acquisition_method: row.acquisition_method,
      match: matchReason(row, naicsCodes),
    }));

    return json(200, {
      ok: true,
      results,
      naics_codes: naicsCodes,
      data_source: { relation: 'state_contract_opportunities (APIE Procurement Warehouse, this Supabase project)' },
    });
  } catch (error) {
    console.error('[ngcc-state-matches]', error);
    return json(500, { ok: false, error: error instanceof Error ? error.message : 'State contract matching failed.' });
  }
}

export const config = {
  path: '/api/state-matches',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
