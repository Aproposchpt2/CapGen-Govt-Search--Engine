// NGCC — state contract matching for a verified business profile, reusing the
// state_contract_opportunities table already populated by the Procurement
// Warehouse acquisition pipeline (CA/NV/AZ scrapers) in this repo's shared
// Supabase project. Registered Federal Contractors Portal merge, 2026-08-16.
//
// NAICS is deliberately NOT a filter here (fixed 2026-08-17, live bug found
// during testing) -- NAICS classification is a federal/SAM.gov concept, and
// confirmed against the real data, 0 of 211 currently-eligible state rows
// have naics_codes populated at all (the CA/NV/AZ acquisition pipelines never
// write that field), so gating on it silently returned zero matches for
// every profile, every time. State matching runs entirely on keyword
// overlap between the verified profile's services/products/capabilities/
// procurement terms and each opportunity's title + description -- the two
// fields that actually are populated (100% and ~99.5% respectively).
import { db, json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

// match_readiness_status=eq.MATCH_READY is a real, meaningful gate (99 of
// 211 currently-eligible rows -- confirmed against live data, unlike
// naics_codes) -- only show contracts whose document package + requirements
// extraction actually completed, same standard NAT-CORP's own dashboard uses.
const RELEASE_FILTER = 'natcorp_release_status=eq.eligible&is_latest_version=eq.true&status=eq.open&match_readiness_status=eq.MATCH_READY';
const SELECT = 'select=id,title,description,agency:issuing_organization,solicitation_number:solicitation_number,state_code,jurisdiction_name,place_of_performance_county,procurement_type,response_deadline,posted_at,source_url,official_source_url,acquisition_method,package_document_count,match_readiness_status,naics_codes';

// Real profile fields are full descriptive phrases -- e.g. "Government
// Technology (custom software, AI, data engineering)" -- not atomic
// keywords. An ILIKE match against the whole phrase, punctuation and all,
// essentially never matches a real contract title/description verbatim
// (confirmed live: this returned zero matches for a real, populated profile
// with genuinely relevant services on file). Tokenize into individual
// words instead and rank by frequency across fields, so words that recur
// across services/products/capabilities (more likely core to the business)
// surface before incidental ones.
const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'of', 'to', 'or', 'in', 'on', 'at', 'by', 'your', 'our']);

function collectTerms(verified) {
  const pool = [
    ...(verified.procurement_terms || []),
    ...(verified.keywords || []),
    ...(verified.services || []),
    ...(verified.products || []),
    ...(verified.capabilities || []),
  ];
  const words = pool
    .flatMap((phrase) => String(phrase || '').toLowerCase().split(/[^a-z0-9]+/))
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 12);
}

async function queryByKeyword(terms) {
  if (!terms.length) return [];
  const or = terms.flatMap((term) => [`title.ilike.*${encodeURIComponent(term)}*`, `description.ilike.*${encodeURIComponent(term)}*`]).join(',');
  return db('state_contract_opportunities', 'GET', `?${RELEASE_FILTER}&or=(${or})&${SELECT}&order=response_deadline.asc.nullslast&limit=150`) || [];
}

function matchedTerms(row, terms) {
  const hay = `${row.title || ''} ${row.description || ''}`.toLowerCase();
  return terms.filter((term) => hay.includes(term.toLowerCase()));
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });
    if (session.discovery_status !== 'verified') return json(409, { ok: false, error: 'Verify your business profile before searching state contract matches.' });

    const verified = session.verified_profile || {};
    const terms = collectTerms(verified);

    const rows = await queryByKeyword(terms);
    const byId = new Map();
    for (const row of rows) byId.set(row.id, row);

    const results = [...byId.values()].map((row) => {
      const hits = matchedTerms(row, terms);
      return {
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
        package_document_count: row.package_document_count || 0,
        match_readiness_status: row.match_readiness_status,
        naics_codes: row.naics_codes || [],
        match: { basis: 'keyword', detail: hits.length ? `Matched on: ${hits.slice(0, 3).join(', ')}` : 'Matched on procurement-term keyword search.' },
      };
    });

    return json(200, {
      ok: true,
      results,
      search_terms: terms,
      data_source: { relation: 'State contract inventory — official government records' },
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
