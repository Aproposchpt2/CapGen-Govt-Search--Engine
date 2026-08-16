// NGCC — business capability profile intake (website AI discovery), ported
// from NAT-CORP's netlify/functions/capability-profile.mjs (2026-08-16,
// Registered Federal Contractors Portal merge). Persists into the SAME
// shared aoie_business_profiles / aoie_business_classification_codes tables
// NAT-CORP writes to -- a profile built here is immediately usable by
// NAT-CORP's state-contract matching too, and vice versa. Only real change
// from the source: PROFILE_VERSION and the intake source tag identify this
// as NGCC-originated, so the two products' intake volume stays distinguishable
// in natcorp_business_intakes without needing separate tables.
import { db, env, json, nowIso, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import {
  asArray,
  issueProfileSession,
  loadProfileSession,
  normalizeWebsite,
  profileSessionCookie,
  publicProfileSession,
  safe,
  sameBusinessDomain,
  validEmail,
} from './_shared/ngcc-profile-session.mjs';

const PROFILE_VERSION = 'ngcc_web_capability_v1';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function uniqueStrings(values, max = 40) {
  return [...new Set(asArray(values).map((value) => safe(typeof value === 'object' ? value?.name : value, 240)).filter(Boolean))].slice(0, max);
}

function evidenceItems(values, domain, max = 30) {
  const result = [];
  for (const raw of asArray(values).slice(0, max * 2)) {
    const name = safe(raw?.name || raw?.capability || raw?.service || raw?.product, 240);
    if (!name) continue;
    const sourceUrl = safe(raw?.source_url, 700);
    if (sourceUrl && !sameBusinessDomain(sourceUrl, domain)) continue;
    result.push({
      name,
      evidence: safe(raw?.evidence || raw?.basis, 1200),
      source_url: sourceUrl || null,
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(safe(raw?.confidence).toUpperCase()) ? safe(raw?.confidence).toUpperCase() : 'MEDIUM',
    });
    if (result.length >= max) break;
  }
  return result;
}

function classificationItems(values, domain, max = 20) {
  const seen = new Set();
  const out = [];
  for (const raw of asArray(values)) {
    const code = safe(raw?.code, 12).replace(/[^0-9]/g, '');
    if (code.length < 2 || code.length > 8 || seen.has(code)) continue;
    const sourceUrl = safe(raw?.source_url, 700);
    if (sourceUrl && !sameBusinessDomain(sourceUrl, domain)) continue;
    seen.add(code);
    out.push({
      code,
      description: safe(raw?.description, 300),
      basis: safe(raw?.basis || raw?.evidence, 1000),
      source_url: sourceUrl || null,
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(safe(raw?.confidence).toUpperCase()) ? safe(raw?.confidence).toUpperCase() : 'MEDIUM',
      authority: 'DERIVED',
    });
    if (out.length >= max) break;
  }
  return out;
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of asArray(data?.output)) {
    if (item?.type !== 'message') continue;
    for (const content of asArray(item.content)) if (content?.type === 'output_text' && content.text) parts.push(content.text);
  }
  return parts.join('\n');
}

function parseJsonText(text) {
  const value = safe(text, 30000).replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
  throw new Error('Website discovery did not return valid structured data.');
}

async function discoverWebsite(session) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new Error('Business website discovery is unavailable because the OpenAI API is not configured.');
  const domain = session.canonical_domain;
  if (!domain) throw new Error('The business website domain is unavailable.');
  const model = env('OPENAI_CAPABILITY_DISCOVERY_MODEL') || 'gpt-5-mini';
  const prompt = `NGCC WEBSITE CAPABILITY DISCOVERY\n\nBusiness submitted name: ${session.business_name}\nOfficial website: ${session.website}\nOfficial domain: ${domain}\n\nMission: understand what this business actually provides so NGCC can build a federal contract-search capability profile. Use ONLY pages on the allowed official business domain. Prefer homepage, services, capabilities, products, solutions, industries, markets, about, projects/portfolio, government/public-sector, certifications, and other relevant internal pages. Never infer a capability solely because it is common in the industry. Never invent services, products, licenses, certifications, customers, locations, NAICS codes, or source URLs. If evidence is insufficient, say so.\n\nFor every service, product, capability, and core competency, retain a short evidence statement and the official source URL. Resident state may be returned only when the official site provides credible business-location evidence. NAICS values are recommendations derived from website evidence; they are never authoritative company-supplied codes unless the site explicitly states them.\n\nReturn ONLY JSON using this exact shape:\n{\n  "business_identity":{"confirmed_name":"","summary":"","resident_state":"","resident_city":"","location_source_url":""},\n  "services":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "products":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "capabilities":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "core_competencies":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "industries":[],\n  "procurement_terms":[],\n  "naics_candidates":[{"code":"","description":"","basis":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "source_urls":[],\n  "discovery_confidence":"HIGH|MEDIUM|LOW",\n  "insufficient_evidence":false\n}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: 'Use current public web evidence from the allowed business domain only. Return one valid JSON object and never invent evidence.' },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'web_search', filters: { allowed_domains: [domain] }, search_context_size: 'low' }],
      max_output_tokens: 3500,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Business website discovery failed (${response.status}): ${raw.slice(0, 450)}`);
  const parsed = parseJsonText(extractResponseText(JSON.parse(raw)));
  const identity = parsed?.business_identity || {};
  const locationSource = sameBusinessDomain(identity.location_source_url, domain) ? safe(identity.location_source_url, 700) : null;
  const state = safe(identity.resident_state, 2).toUpperCase();
  const residentState = /^[A-Z]{2}$/.test(state) ? state : null;
  const sourceUrls = uniqueStrings(asArray(parsed?.source_urls).filter((url) => sameBusinessDomain(url, domain)), 30);
  const services = evidenceItems(parsed?.services, domain);
  const products = evidenceItems(parsed?.products, domain);
  const capabilities = evidenceItems(parsed?.capabilities, domain);
  const coreCompetencies = evidenceItems(parsed?.core_competencies, domain);
  const confidenceLabel = ['HIGH', 'MEDIUM', 'LOW'].includes(safe(parsed?.discovery_confidence).toUpperCase()) ? safe(parsed.discovery_confidence).toUpperCase() : 'MEDIUM';
  const evidenceCount = services.length + products.length + capabilities.length + coreCompetencies.length;
  return {
    profile_version: PROFILE_VERSION,
    business_name: safe(identity.confirmed_name, 240) || session.business_name,
    submitted_business_name: session.business_name,
    website: session.website,
    canonical_domain: domain,
    summary: safe(identity.summary, 1600),
    resident_state: residentState,
    resident_city: safe(identity.resident_city, 160) || null,
    location_source_url: locationSource,
    services,
    products,
    capabilities,
    core_competencies: coreCompetencies,
    industries: uniqueStrings(parsed?.industries, 30),
    procurement_terms: uniqueStrings(parsed?.procurement_terms, 60),
    naics_candidates: classificationItems(parsed?.naics_candidates, domain),
    source_urls: sourceUrls,
    discovery_confidence: confidenceLabel,
    insufficient_evidence: Boolean(parsed?.insufficient_evidence) || evidenceCount === 0,
    evidence_count: evidenceCount,
    discovered_at: nowIso(),
    model,
  };
}

function matchingProfile(session, supplied = {}) {
  const draft = session.draft_profile || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(supplied, key);
  const items = (key, fallback) => uniqueStrings(has(key) ? supplied[key] : fallback);
  const services = items('services', asArray(draft.services).map((item) => item.name));
  const products = items('products', asArray(draft.products).map((item) => item.name));
  const capabilities = items('capabilities', asArray(draft.capabilities).map((item) => item.name));
  const coreCompetencies = items('core_competencies', asArray(draft.core_competencies).map((item) => item.name));
  const industries = items('industries', draft.industries);
  const procurementTerms = items('procurement_terms', draft.procurement_terms);
  const residentStateRaw = safe(has('resident_state') ? supplied.resident_state : draft.resident_state, 2).toUpperCase();
  const residentState = /^[A-Z]{2}$/.test(residentStateRaw) ? residentStateRaw : null;
  const naicsCandidates = classificationItems(has('naics_candidates') ? supplied.naics_candidates : draft.naics_candidates, session.canonical_domain);
  const keywords = uniqueStrings([...procurementTerms, ...services, ...products, ...capabilities, ...coreCompetencies, ...industries], 80);
  if (!(services.length || products.length || capabilities.length || coreCompetencies.length)) throw new Error('Confirm at least one business service, product, capability, or core competency.');
  return {
    profile_version: PROFILE_VERSION,
    business_name: session.business_name,
    legal_name: session.business_name,
    website: session.website,
    resident_state: residentState,
    resident_city: draft.resident_city || null,
    summary: safe(has('summary') ? supplied.summary : draft.summary, 1600),
    services,
    products,
    capabilities,
    core_competencies: coreCompetencies,
    industries,
    procurement_terms: procurementTerms,
    keywords,
    naics_candidates: naicsCandidates,
    naics_codes: naicsCandidates.map((item) => item.code),
    service_states: [],
    states: [],
    geographic_search_scope: 'all_states',
    evidence_policy: 'Website-derived classifications remain DERIVED unless separately validated.',
    user_confirmed: true,
    confirmed_at: nowIso(),
  };
}

function confidenceScore(label) {
  return label === 'HIGH' ? 90 : label === 'LOW' ? 45 : 70;
}

async function persistVerifiedProfile(session, verified) {
  const taxonomyRows = await db('aoie_taxonomy_versions', 'GET', '?select=id&order=created_at.desc&limit=1');
  const taxonomyVersionId = taxonomyRows?.[0]?.id;
  if (!taxonomyVersionId) throw new Error('AOIE taxonomy version is unavailable.');
  const now = nowIso();
  const provenance = {
    source: 'NGCC website capability discovery',
    intake_id: session.intake_id,
    profile_version: PROFILE_VERSION,
    official_domain: session.canonical_domain,
    website: session.website,
    discovery_confidence: session.draft_profile?.discovery_confidence || 'MEDIUM',
    classification_policy: 'Derived classification codes are not authoritative business-supplied codes unless separately validated.',
    evidence: session.discovery_evidence || [],
  };
  const description = verified.summary || uniqueStrings([...verified.services, ...verified.capabilities, ...verified.products], 20).join('; ');
  const profilePayload = {
    legal_business_name: session.business_name,
    business_description: description || null,
    website: session.website,
    primary_location: { city: verified.resident_city || null, state: verified.resident_state || null, source_url: session.draft_profile?.location_source_url || null },
    service_territory: { scope: 'all_states', resident_state: verified.resident_state || null },
    taxonomy_version_id: taxonomyVersionId,
    completion_score: Math.min(100, 65 + Math.min(verified.capabilities.length + verified.services.length + verified.products.length, 7) * 5),
    confidence_score: confidenceScore(session.draft_profile?.discovery_confidence),
    verification_status: 'USER_CONFIRMED',
    last_reviewed_at: now,
    next_review_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    user_confirmed: true,
    visit_scoped: false,
    source_provenance: provenance,
    updated_at: now,
  };

  let profileId = session.business_profile_id || null;
  if (profileId) {
    const rows = await db('aoie_business_profiles', 'PATCH', `?id=eq.${encodeURIComponent(profileId)}`, profilePayload, 'return=representation');
    if (!rows?.[0]) profileId = null;
  }
  if (!profileId) {
    const rows = await db('aoie_business_profiles', 'POST', '', [{ ...profilePayload, created_at: now }], 'return=representation');
    profileId = rows?.[0]?.id || null;
  }
  if (!profileId) throw new Error('Verified AOIE business profile could not be persisted.');

  await db('aoie_business_classification_codes', 'DELETE', `?business_profile_id=eq.${encodeURIComponent(profileId)}&code_system=eq.NAICS`);
  if (verified.naics_candidates.length) {
    await db('aoie_business_classification_codes', 'POST', '', verified.naics_candidates.map((item) => ({
      business_profile_id: profileId,
      code_system: 'NAICS',
      code: item.code,
      description: item.description || item.basis || null,
      verified: false,
    })), 'resolution=ignore-duplicates,return=minimal');
  }
  return profileId;
}

async function start(req, payload) {
  const contactName = safe(payload.contact_name, 220);
  const businessName = safe(payload.business_name, 240);
  const businessEmail = validEmail(payload.business_email);
  const visitorEmail = payload.visitor_email ? validEmail(payload.visitor_email) : '';
  if (contactName.length < 2) throw new Error('Name is required.');
  if (businessName.length < 2) throw new Error('Business name is required.');
  if (!businessEmail) throw new Error('Enter a valid business email address.');
  if (payload.visitor_email && !visitorEmail) throw new Error('Optional owner / visiting customer email is not valid.');
  const website = normalizeWebsite(payload.website);
  const issued = issueProfileSession();
  const now = nowIso();
  const intakePayload = {
    contact_name: contactName,
    business_name: businessName,
    business_email: businessEmail,
    website: website.website,
    visitor_email: visitorEmail || null,
    source: 'ngcc-website-capability-intake-v1',
    started_at: now,
  };
  const rows = await db('natcorp_business_intakes', 'POST', '', [{
    opportunity_id: null,
    intake_kind: 'business_profile',
    status: 'started',
    contact_email: businessEmail,
    intake_payload: intakePayload,
    session_token_hash: issued.token_hash,
    session_expires_at: issued.expires_at,
    contact_name: contactName,
    business_name: businessName,
    business_email: businessEmail,
    website: website.website,
    visitor_email: visitorEmail || null,
    canonical_domain: website.canonical_domain,
    discovery_status: 'intake_created',
    draft_profile: {},
    discovery_evidence: [],
    verified_profile: {},
    matching_scope: 'all_states',
    created_at: now,
    updated_at: now,
  }], 'return=representation');
  const session = rows?.[0];
  if (!session) throw new Error('Business intake could not be created.');
  return jsonResponse(201, { ok: true, session: publicProfileSession(session) }, { 'set-cookie': profileSessionCookie(issued.token) });
}

async function runDiscovery(req) {
  const session = await loadProfileSession(req);
  if (!session) return jsonResponse(401, { error: 'Business discovery session is missing or expired.' });
  if (session.discovery_status === 'verified') return jsonResponse(200, { ok: true, session: publicProfileSession(session) });
  if (session.discovery_status === 'review_ready' && session.draft_profile?.profile_version === PROFILE_VERSION) return jsonResponse(200, { ok: true, session: publicProfileSession(session) });
  await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, { discovery_status: 'discovering', last_error: null, updated_at: nowIso() }, 'return=minimal');
  try {
    const draft = await discoverWebsite(session);
    const evidence = [
      ...draft.services,
      ...draft.products,
      ...draft.capabilities,
      ...draft.core_competencies,
    ].filter((item) => item.source_url || item.evidence);
    const rows = await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, {
      discovery_status: 'review_ready',
      draft_profile: draft,
      discovery_evidence: evidence,
      resident_state: draft.resident_state,
      last_error: null,
      updated_at: nowIso(),
    }, 'return=representation');
    return jsonResponse(200, { ok: true, session: publicProfileSession(rows?.[0] || { ...session, draft_profile: draft, discovery_evidence: evidence, resident_state: draft.resident_state, discovery_status: 'review_ready' }) });
  } catch (error) {
    await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, { discovery_status: 'failed', last_error: safe(error.message, 1200), updated_at: nowIso() }, 'return=minimal').catch(() => {});
    throw error;
  }
}

async function confirm(req, payload) {
  const session = await loadProfileSession(req);
  if (!session) return jsonResponse(401, { error: 'Business profile session is missing or expired.' });
  if (!session.draft_profile?.profile_version) return jsonResponse(409, { error: 'Website discovery must finish before profile verification.' });
  const verified = matchingProfile(session, payload.profile || {});
  const profileId = await persistVerifiedProfile(session, verified);
  const now = nowIso();
  const rows = await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, {
    business_profile_id: profileId,
    status: 'dna_complete',
    discovery_status: 'verified',
    verified_profile: verified,
    resident_state: verified.resident_state,
    verified_at: now,
    submitted_at: now,
    last_error: null,
    updated_at: now,
  }, 'return=representation');
  return jsonResponse(200, { ok: true, session: publicProfileSession(rows?.[0] || { ...session, business_profile_id: profileId, verified_profile: verified, resident_state: verified.resident_state, discovery_status: 'verified', status: 'dna_complete', verified_at: now }) });
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  try {
    if (req.method === 'GET') {
      const session = await loadProfileSession(req);
      if (!session) return jsonResponse(401, { ok: false, error: 'Business profile session is missing or expired.' });
      return jsonResponse(200, { ok: true, session: publicProfileSession(session) });
    }
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'GET or POST only.' });
    let payload;
    try { payload = await req.json(); } catch { return jsonResponse(400, { ok: false, error: 'Invalid JSON.' }); }
    const action = safe(payload?.action, 40).toLowerCase();
    if (action === 'start') return start(req, payload);
    if (action === 'discover') return runDiscovery(req);
    if (action === 'confirm') return confirm(req, payload);
    return jsonResponse(400, { ok: false, error: 'Unknown capability-profile action.' });
  } catch (error) {
    console.error('[capability-profile]', error);
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : 'Business capability profile operation failed.' });
  }
}

export const config = {
  path: '/api/capability-profile',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
