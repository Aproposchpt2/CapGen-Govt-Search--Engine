'use strict';

const { OPENAI_KEY } = require('./ngcc-ops');

const DIMENSION_KEYS = [
  'current_capability_alignment',
  'mandatory_requirements',
  'certifications_licenses',
  'past_performance',
  'set_aside_classification',
  'geography_capacity',
  'supplier_role',
];

// Stage 05 is a synchronous operator action. Current public-web verification is
// deliberately bounded so that evidence research cannot hold the entire stage
// open until the platform/proxy inactivity ceiling is reached. Candidates not
// researched in this pass remain UNVERIFIED/INSUFFICIENT_EVIDENCE; they are
// never treated as mismatches merely because the bounded pass did not reach them.
const DEFAULT_VERIFICATION_LIMIT = 5;
const MAX_VERIFICATION_LIMIT = 8;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 35000;

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeVerificationLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VERIFICATION_LIMIT;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_VERIFICATION_LIMIT));
}

function normalizeVerificationTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VERIFICATION_TIMEOUT_MS;
  return Math.max(5000, Math.min(Math.floor(parsed), DEFAULT_VERIFICATION_TIMEOUT_MS));
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) out.push(content.text);
    }
  }
  return out.join('\n');
}

function parseJsonText(text) {
  const normalized = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(normalized); } catch {}
  const first = normalized.indexOf('{');
  const last = normalized.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(normalized.slice(first, last + 1));
  throw new Error('Capability verification response did not contain valid JSON.');
}

function normalizeStatus(value) {
  const status = clean(value).toUpperCase();
  return ['SUPPORTED', 'MISMATCH', 'UNVERIFIED'].includes(status) ? status : 'UNVERIFIED';
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object') return null;
  const url = clean(source.url);
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    title: clean(source.title) || null,
    note: clean(source.note) || null,
  };
}

function normalizeDimension(value) {
  const input = value && typeof value === 'object' ? value : {};
  const sources = (Array.isArray(input.sources) ? input.sources : []).map(normalizeSource).filter(Boolean);
  let status = normalizeStatus(input.status);
  // Positive or negative conclusions require a citable public source. Absence
  // of evidence must remain UNVERIFIED; it is never converted into a mismatch.
  if ((status === 'SUPPORTED' || status === 'MISMATCH') && !sources.length) status = 'UNVERIFIED';
  return {
    status,
    reason: clean(input.reason) || null,
    sources,
  };
}

function candidateKey(candidate = {}) {
  return clean(candidate.ueiSAM || candidate.uei) || `${clean(candidate.businessName || candidate.business_name)}|${clean(candidate.state)}`;
}

function emptyVerification(candidate = {}, status = 'NOT_VERIFIED', note = null) {
  const dimensions = {};
  DIMENSION_KEYS.forEach(key => { dimensions[key] = { status: 'UNVERIFIED', reason: note, sources: [] }; });
  return {
    key: candidateKey(candidate),
    uei: clean(candidate.ueiSAM || candidate.uei) || null,
    business_name: clean(candidate.businessName || candidate.business_name) || null,
    status,
    verified_at: null,
    sources: [],
    dimensions,
  };
}

function normalizeVerification(raw = {}, candidate = {}) {
  const normalized = emptyVerification(candidate, clean(raw.status).toUpperCase() || 'PARTIAL');
  normalized.verified_at = clean(raw.verified_at) || new Date().toISOString();
  normalized.sources = (Array.isArray(raw.sources) ? raw.sources : []).map(normalizeSource).filter(Boolean);
  DIMENSION_KEYS.forEach(key => { normalized.dimensions[key] = normalizeDimension(raw.dimensions?.[key]); });
  const supportedOrMismatch = DIMENSION_KEYS.filter(key => ['SUPPORTED', 'MISMATCH'].includes(normalized.dimensions[key].status)).length;
  normalized.status = supportedOrMismatch ? (supportedOrMismatch === DIMENSION_KEYS.length ? 'VERIFIED' : 'PARTIAL') : 'NOT_FOUND';
  return normalized;
}

function contractVerificationProfile(contractDna = {}) {
  return {
    title: clean(contractDna.title),
    agency: clean(contractDna.agency),
    primary_requirement: clean(contractDna.requirement?.primary_requirement),
    products_services: contractDna.requirement?.products_services || [],
    required_capabilities: contractDna.requirement?.required_capabilities || [],
    required_certifications: contractDna.requirement?.required_certifications || [],
    required_experience: contractDna.requirement?.required_experience || [],
    supplier_role: clean(contractDna.requirement?.supplier_role),
    place_of_performance: clean(contractDna.requirement?.place_of_performance),
    set_aside: clean(contractDna.competition?.set_aside || contractDna.competition?.eligible_business_classification),
    mandatory_requirements: contractDna.hard_constraints?.mandatory_requirements || [],
    geographic_restrictions: contractDna.hard_constraints?.geographic_restrictions || [],
    manufacturer_supplier_restrictions: contractDna.hard_constraints?.manufacturer_supplier_restrictions || [],
  };
}

function candidateVerificationProfile(candidate = {}) {
  return {
    key: candidateKey(candidate),
    uei: clean(candidate.ueiSAM || candidate.uei),
    cage_code: clean(candidate.cageCode || candidate.cage_code),
    business_name: clean(candidate.businessName || candidate.business_name),
    city: clean(candidate.city),
    state: clean(candidate.state),
    primary_naics: clean(candidate.primary_naics),
    registered_naics: candidate.registered_naics || [],
    business_classifications: candidate.business_classifications || [],
  };
}

async function verifyCandidateCapabilities(candidates = [], contractDna = {}, options = {}) {
  const limit = normalizeVerificationLimit(options.limit);
  const timeoutMs = normalizeVerificationTimeout(options.timeout_ms);
  const targets = (Array.isArray(candidates) ? candidates : []).slice(0, limit);
  const fallback = new Map(targets.map(candidate => [candidateKey(candidate), emptyVerification(candidate)]));
  if (!targets.length) return { status: 'ZERO_RESULT', verifications: fallback, error: null, target_count: 0, limit, timeout_ms: timeoutMs };
  if (!OPENAI_KEY) return { status: 'CONFIGURATION_UNAVAILABLE', verifications: fallback, error: 'OPENAI_API_KEY is not configured.', target_count: targets.length, limit, timeout_ms: timeoutMs };

  const contract = contractVerificationProfile(contractDna);
  const candidateProfiles = targets.map(candidateVerificationProfile);
  const prompt = `You are performing evidence-controlled contractor capability verification for a federal procurement workflow.

CONTRACT:\n${JSON.stringify(contract, null, 2)}

CANDIDATES:\n${JSON.stringify(candidateProfiles, null, 2)}

For EACH candidate, research current public evidence and determine whether the business currently appears capable of performing the specific contract requirement.

CRITICAL RULES:
1. A SAM.gov registration, NAICS code, PSC code, UEI, CAGE code, or generic business category is DISCOVERY evidence only. It is NOT proof that the business currently provides the required service or can perform this contract.
2. Prefer the business's current official website, current government records, current agency/contract-award records, and other authoritative public sources.
3. Do not infer a capability from the company name, a NAICS code, or absence of contrary evidence.
4. Use MISMATCH only when an affirmative source shows a conflict or clearly different current capability. If evidence is merely missing, stale, ambiguous, or inaccessible, use UNVERIFIED.
5. SUPPORTED and MISMATCH conclusions must include at least one source URL. If no citable source supports the conclusion, use UNVERIFIED.
6. Past performance means evidence of relevant performed work, not simply a claimed capability.
7. Certifications/licenses must be contract-relevant. Do not treat generic SAM registration as a professional certification.
8. Evaluate each business independently. Do not copy conclusions across candidates.
9. Do not create a fit score. Return evidence states only; NGCC calculates scores separately.
10. Work only on the supplied candidates. If a fact cannot be established quickly from a reliable current public source, mark it UNVERIFIED rather than continuing broad research.

Return ONLY valid JSON in exactly this shape:
{
  "verifications": [
    {
      "key": "candidate key exactly as supplied",
      "uei": "",
      "business_name": "",
      "status": "VERIFIED|PARTIAL|NOT_FOUND",
      "verified_at": "ISO-8601 timestamp",
      "sources": [{"url":"https://...","title":"","note":""}],
      "dimensions": {
        "current_capability_alignment": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[{"url":"https://...","title":"","note":""}]},
        "mandatory_requirements": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
        "certifications_licenses": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
        "past_performance": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
        "set_aside_classification": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
        "geography_capacity": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
        "supplier_role": {"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]}
      }
    }
  ]
}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Capability verification timebox exceeded.')), timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        input: [
          {
            role: 'system',
            content: 'Use current public web sources. Be conservative and efficient. NAICS/SAM data is retrieval evidence, not proof of operational capability. Return only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        max_output_tokens: 5000,
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenAI capability verification failed (${response.status}): ${raw.slice(0, 500)}`);
    const parsed = parseJsonText(extractResponseText(JSON.parse(raw)));
    const rawRows = Array.isArray(parsed.verifications) ? parsed.verifications : [];
    const byKey = new Map(rawRows.map(row => [clean(row.key), row]).filter(([key]) => key));
    const results = new Map();
    for (const candidate of targets) {
      const key = candidateKey(candidate);
      const row = byKey.get(key);
      results.set(key, row ? normalizeVerification(row, candidate) : emptyVerification(candidate, 'NOT_FOUND', 'No candidate-specific public verification result was returned.'));
    }
    return { status: 'SUCCESS', verifications: results, error: null, target_count: targets.length, limit, timeout_ms: timeoutMs };
  } catch (error) {
    const timedOut = controller.signal.aborted || clean(error?.name).toUpperCase() === 'ABORTERROR';
    const status = timedOut ? 'TIMEBOX_EXCEEDED' : 'FAILED';
    const note = timedOut
      ? `Current public capability verification exceeded the ${timeoutMs} ms synchronous research timebox; unresolved evidence remains UNVERIFIED.`
      : clean(error.message || error);
    return {
      status,
      verifications: new Map(targets.map(candidate => [candidateKey(candidate), emptyVerification(candidate, status, note)])),
      error: note,
      target_count: targets.length,
      limit,
      timeout_ms: timeoutMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DIMENSION_KEYS,
  DEFAULT_VERIFICATION_LIMIT,
  MAX_VERIFICATION_LIMIT,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  normalizeVerificationLimit,
  normalizeVerificationTimeout,
  candidateKey,
  emptyVerification,
  normalizeStatus,
  normalizeDimension,
  normalizeVerification,
  contractVerificationProfile,
  candidateVerificationProfile,
  verifyCandidateCapabilities,
};