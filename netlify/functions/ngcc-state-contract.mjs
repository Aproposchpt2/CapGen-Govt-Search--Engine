// RFCP — internal State Contract Workspace detail endpoint. Mirrors
// ngcc-federal-contract.mjs's pattern exactly: never expose the upstream
// agency's own procurement-portal URL to the client. Fixed 2026-08-17 after
// live testing caught dashboard.html's "View official listing" button
// redirecting a real visitor to camisvr.co.la.ca.us (LA County eCAPS) --
// the same class of issue the federal side already had fixed for it.
import { db, json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

const RELEASE_FILTER = 'natcorp_release_status=eq.eligible&is_latest_version=eq.true';
const SELECT = 'select=id,title,description,agency:issuing_organization,solicitation_number:solicitation_number,state_code,jurisdiction_name,place_of_performance_county,procurement_type,response_deadline,posted_at,acquisition_method,package_document_count,match_readiness_status,naics_codes,status';

function safe(value) { return String(value ?? '').trim(); }

function sanitizeOpportunity(row) {
  return {
    id: row.id,
    inventory_source: 'state_local',
    source_opportunity_id: row.id,
    title: row.title || 'Untitled opportunity',
    agency: row.agency || 'Public agency',
    solicitation_number: row.solicitation_number || null,
    state_code: row.state_code || null,
    jurisdiction_name: row.jurisdiction_name || null,
    place_of_performance_county: row.place_of_performance_county || null,
    procurement_type: row.procurement_type || null,
    response_deadline: row.response_deadline || null,
    posted_at: row.posted_at || null,
    naics_codes: row.naics_codes || [],
    status: row.status || null,
    description: row.description || null,
    package_document_count: row.package_document_count || 0,
    match_readiness_status: row.match_readiness_status || null,
    package_status: Number(row.package_document_count || 0) > 0 ? 'available_not_asserted_complete' : 'unavailable',
    matching_basis: 'business_capability_keywords',
    matching_limitations: ['SAM NAICS did not contribute to this State/local match.', 'Package completeness is not assumed.'],
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
    const id = safe(requestUrl.searchParams.get('id'));
    if (!id) return json(400, { ok: false, error: 'Contract ID is required.' });

    const rows = await db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(id)}&${RELEASE_FILTER}&${SELECT}&limit=1`);
    const row = rows?.[0];
    if (!row) return json(404, { ok: false, error: 'This state contract is no longer available.' });

    return json(200, {
      ok: true,
      contract: sanitizeOpportunity(row),
      provenance: { inventory_source: 'state_local', source_type: 'official State/local government record', retained_internally: true },
    });
  } catch (error) {
    console.error('[rfcp-state-contract]', error);
    return json(500, { ok: false, error: 'The state contract workspace could not be loaded.' });
  }
}

export const config = {
  path: '/api/state-contract',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
