'use strict';

const { OPENAI_KEY } = require('./ngcc-ops');
const {
  candidateKey,
  contractVerificationProfile,
  normalizeVerification,
} = require('./ngcc-contractor-capability-verification');

const MAX_SELECTED_CONTACTS = 5;
const DEFAULT_WEBSITE_RESEARCH_TIMEOUT_MS = 20000;
const CAPABILITY_DIMENSIONS = new Set([
  'current_capability_alignment',
  'mandatory_requirements',
  'certifications_licenses',
  'past_performance',
  'set_aside_classification',
  'geography_capacity',
  'supplier_role',
]);

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  for (const item of data?.output || []) {
    if (item?.type === 'message') {
      for (const content of item.content || []) {
        if (content?.type === 'output_text' && content.text) out.push(content.text);
      }
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
  throw new Error('Contact discovery response did not contain valid JSON.');
}

function isPublicEmailCandidate(email) {
  const value = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function normalizeContactLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAX_SELECTED_CONTACTS;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_SELECTED_CONTACTS));
}

function normalizeResearchTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WEBSITE_RESEARCH_TIMEOUT_MS;
  return Math.max(5000, Math.min(Math.floor(parsed), DEFAULT_WEBSITE_RESEARCH_TIMEOUT_MS));
}

function cleanUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function sameHost(left, right) {
  try {
    return new URL(left).hostname.replace(/^www\./i, '').toLowerCase() === new URL(right).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return false;
  }
}

function normalizePages(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (typeof item === 'string') return { url: cleanUrl(item), note: null };
      return { url: cleanUrl(item?.url), note: String(item?.note || '').trim() || null };
    })
    .filter(item => item.url)
    .slice(0, 12);
}

function knownCapabilityEvidence(verification) {
  const dimensions = verification?.dimensions || {};
  return Object.values(dimensions).some(item => ['SUPPORTED', 'MISMATCH'].includes(String(item?.status || '').toUpperCase()));
}

function mergeCapabilityVerifications(existing, fresh, candidate = {}) {
  if (!fresh || !knownCapabilityEvidence(fresh)) return existing || null;
  if (!existing || !knownCapabilityEvidence(existing)) return fresh;

  const dimensionKeys = new Set([
    ...Object.keys(existing.dimensions || {}),
    ...Object.keys(fresh.dimensions || {}),
  ]);
  const dimensions = {};
  for (const key of dimensionKeys) {
    const oldItem = existing.dimensions?.[key] || {};
    const newItem = fresh.dimensions?.[key] || {};
    const newKnown = ['SUPPORTED', 'MISMATCH'].includes(String(newItem.status || '').toUpperCase());
    const chosen = newKnown ? newItem : oldItem;
    dimensions[key] = {
      ...chosen,
      sources: [
        ...(Array.isArray(oldItem.sources) ? oldItem.sources : []),
        ...(Array.isArray(newItem.sources) ? newItem.sources : []),
      ].filter((source, index, all) => {
        const url = String(source?.url || source || '').trim();
        if (!url) return false;
        return all.findIndex(other => String(other?.url || other || '').trim() === url) === index;
      }),
    };
  }

  return normalizeVerification({
    status: fresh.status || existing.status || 'PARTIAL',
    verified_at: fresh.verified_at || existing.verified_at || new Date().toISOString(),
    sources: [
      ...(Array.isArray(existing.sources) ? existing.sources : []),
      ...(Array.isArray(fresh.sources) ? fresh.sources : []),
    ].filter((source, index, all) => {
      const url = String(source?.url || source || '').trim();
      if (!url) return false;
      return all.findIndex(other => String(other?.url || other || '').trim() === url) === index;
    }),
    dimensions,
  }, candidate);
}

function capabilityEvidenceVerification(items, candidate = {}) {
  const rows = Array.isArray(items) ? items : [];
  const dimensions = {};
  const sources = [];

  for (const row of rows) {
    const dimension = String(row?.dimension || '').trim().toLowerCase();
    const status = String(row?.status || '').trim().toUpperCase();
    const url = cleanUrl(row?.url);
    if (!CAPABILITY_DIMENSIONS.has(dimension)) continue;
    if (!['SUPPORTED', 'MISMATCH'].includes(status) || !url) continue;
    const source = {
      url,
      title: String(row?.title || '').trim() || null,
      note: String(row?.reason || '').trim() || null,
    };
    dimensions[dimension] = {
      status,
      reason: String(row?.reason || '').trim() || null,
      sources: [source],
    };
    sources.push(source);
  }

  if (!Object.keys(dimensions).length) return null;
  return normalizeVerification({
    status: 'PARTIAL',
    verified_at: new Date().toISOString(),
    sources,
    dimensions,
  }, candidate);
}

function websiteResearchPrompt(candidate = {}, contractDna = null) {
  const businessName = String(candidate.business_name || candidate.businessName || '').trim();
  const location = [candidate.city, candidate.state].filter(Boolean).join(', ') || 'Unavailable';
  const contract = contractDna && typeof contractDna === 'object' ? contractVerificationProfile(contractDna) : null;
  const compactContract = contract ? {
    title: contract.title,
    primary_requirement: contract.primary_requirement,
    products_services: contract.products_services,
    required_capabilities: contract.required_capabilities,
    required_certifications: contract.required_certifications,
    required_experience: contract.required_experience,
    supplier_role: contract.supplier_role,
    place_of_performance: contract.place_of_performance,
    set_aside: contract.set_aside,
    mandatory_requirements: contract.mandatory_requirements,
  } : null;

  return `Research the current public web presence of this federal contractor. CONTACT DISCOVERY IS THE PRIMARY TASK.

BUSINESS: ${businessName}
LOCATION: ${location}
UEI: ${candidate.uei || candidate.ueiSAM || 'Unavailable'}
CAGE: ${candidate.cage_code || candidate.cageCode || 'Unavailable'}
CONTRACT: ${compactContract ? JSON.stringify(compactContract) : 'Not supplied'}

DO THIS IN ORDER:
1. Find the business's current OFFICIAL website. Reject directories, social profiles, lead-generation pages, and similarly named businesses.
2. Check the official website home/contact/footer and relevant services or capabilities pages.
3. Find a PUBLIC email actually published by that business. Prefer contracts, proposals, government sales, business development, estimating, or general contact email.
4. If the official website has no published email, an email may be accepted only from another official public authority source that explicitly publishes it.
5. Never guess, infer, construct, or pattern-generate an email address.
6. If contract context is present, record ONLY capability evidence actually supported or contradicted by a cited official/current source. Missing evidence stays absent; do not create UNVERIFIED rows.

Return ONLY valid JSON:
{
  "official_website_url":"https://... or null",
  "website_pages_checked":[{"url":"https://...","note":"short note"}],
  "email":"published email or null",
  "contact_name":"name or null",
  "contact_role":"role or null",
  "source_url":"exact page publishing email or null",
  "source_type":"OFFICIAL_WEBSITE|OFFICIAL_PUBLIC_AUTHORITY|NONE",
  "confidence":"HIGH|MEDIUM|LOW",
  "evidence_note":"short explanation",
  "capability_evidence":[
    {"dimension":"current_capability_alignment|mandatory_requirements|certifications_licenses|past_performance|set_aside_classification|geography_capacity|supplier_role","status":"SUPPORTED|MISMATCH","reason":"short reason","url":"https://...","title":"source title"}
  ]
}`;
}

function contactDiscoveryOutcome(summary = {}) {
  const verified = Number(summary.VERIFIED || 0);
  const failed = Number(summary.FAILED || 0);
  if (verified > 0) {
    return { status: 'SUCCESS', retry_required: false, message: `${verified} verified public contact(s) found.` };
  }
  if (failed > 0) {
    return {
      status: 'RETRY_REQUIRED',
      retry_required: true,
      message: 'Website/contact research did not complete successfully. Review the evidence note, select a business, and retry Stage 06.',
    };
  }
  return {
    status: 'RETRY_REQUIRED',
    retry_required: true,
    message: 'No verified public email was found for the selected business. Select another candidate or retry Stage 06; no address was guessed.',
  };
}

async function discoverPublicContact(candidate = {}, options = {}) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const businessName = String(candidate.business_name || candidate.businessName || '').trim();
  if (!businessName) throw new Error('Candidate business name is required.');

  const contractDna = options.contractDna && typeof options.contractDna === 'object' ? options.contractDna : null;
  const timeoutMs = normalizeResearchTimeout(options.timeout_ms);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Website/contact research timebox exceeded.')), timeoutMs);

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
            content: 'Use current public web sources. Find the official business website and a published public email first. Never invent contact information or capability evidence. Return only valid JSON.',
          },
          { role: 'user', content: websiteResearchPrompt(candidate, contractDna) },
        ],
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        max_output_tokens: 1400,
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenAI website/contact discovery failed (${response.status}): ${raw.slice(0, 500)}`);

    const parsed = parseJsonText(extractResponseText(JSON.parse(raw)));
    const email = isPublicEmailCandidate(parsed.email);
    const sourceUrl = cleanUrl(parsed.source_url);
    const officialWebsiteUrl = cleanUrl(parsed.official_website_url);
    const sourceType = String(parsed.source_type || '').trim().toUpperCase();
    const acceptedSource = ['OFFICIAL_WEBSITE', 'OFFICIAL_PUBLIC_AUTHORITY'].includes(sourceType) || (
      sourceUrl && officialWebsiteUrl && sameHost(sourceUrl, officialWebsiteUrl)
    );
    const verified = Boolean(email && sourceUrl && acceptedSource);
    const capabilityVerification = contractDna
      ? capabilityEvidenceVerification(parsed.capability_evidence, candidate)
      : null;

    return {
      key: candidateKey(candidate),
      uei: candidate.uei || candidate.ueiSAM || null,
      cage_code: candidate.cage_code || candidate.cageCode || null,
      business_name: businessName,
      city: candidate.city || null,
      state: candidate.state || null,
      qualification_rank: candidate.rank || null,
      qualification_score: candidate.contract_qualification_score ?? candidate.qualification_score ?? null,
      qualification_status: candidate.qualification_status || null,
      operator_selected: true,
      research_status: officialWebsiteUrl ? 'WEBSITE_FOUND' : 'WEBSITE_NOT_FOUND',
      official_website_url: officialWebsiteUrl,
      website_pages_checked: normalizePages(parsed.website_pages_checked),
      contact_status: verified ? 'VERIFIED' : 'NOT_FOUND',
      contact_email: verified ? email : null,
      contact_name: verified ? (String(parsed.contact_name || '').trim() || null) : null,
      contact_role: verified ? (String(parsed.contact_role || '').trim() || null) : null,
      source_url: verified ? sourceUrl : null,
      source_type: verified ? (sourceType || (sameHost(sourceUrl, officialWebsiteUrl) ? 'OFFICIAL_WEBSITE' : 'OFFICIAL_PUBLIC_AUTHORITY')) : null,
      confidence: verified ? String(parsed.confidence || 'MEDIUM').toUpperCase() : 'LOW',
      evidence_note: String(parsed.evidence_note || '').trim(),
      capability_verification: capabilityVerification,
      outreach_approved: false,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || String(error?.name || '').toUpperCase() === 'ABORTERROR';
    if (timedOut) throw new Error(`Website/contact research exceeded the ${timeoutMs} ms controlled timebox.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverSelectedContacts(candidates = [], options = {}) {
  const selected = (Array.isArray(candidates) ? candidates : []).filter(candidate => candidate.operator_selected === true || candidate.operator_disposition === 'APPROVED');
  const max = normalizeContactLimit(options.limit);
  if (selected.length > max) {
    throw new Error(`Stage 06 website research is limited to ${max} operator-selected businesses per controlled run.`);
  }
  const targets = selected.slice(0, max);

  const results = await Promise.all(targets.map(async candidate => {
    try {
      return await discoverPublicContact(candidate, {
        contractDna: options.contractDna || null,
        timeout_ms: options.timeout_ms,
      });
    } catch (error) {
      return {
        key: candidateKey(candidate),
        uei: candidate.uei || candidate.ueiSAM || null,
        cage_code: candidate.cage_code || candidate.cageCode || null,
        business_name: candidate.business_name || candidate.businessName || null,
        city: candidate.city || null,
        state: candidate.state || null,
        qualification_rank: candidate.rank || null,
        qualification_score: candidate.contract_qualification_score ?? candidate.qualification_score ?? null,
        qualification_status: candidate.qualification_status || null,
        operator_selected: true,
        research_status: 'FAILED',
        official_website_url: null,
        website_pages_checked: [],
        contact_status: 'FAILED',
        contact_email: null,
        contact_name: null,
        contact_role: null,
        source_url: null,
        source_type: null,
        confidence: 'LOW',
        evidence_note: String(error.message || error),
        capability_verification: null,
        outreach_approved: false,
      };
    }
  }));

  const summary = results.reduce((acc, item) => {
    acc.total += 1;
    acc[item.contact_status] = (acc[item.contact_status] || 0) + 1;
    if (item.official_website_url) acc.WEBSITE_FOUND += 1;
    if (item.capability_verification) acc.CAPABILITY_REFRESHED += 1;
    return acc;
  }, { total: 0, VERIFIED: 0, NOT_FOUND: 0, FAILED: 0, WEBSITE_FOUND: 0, CAPABILITY_REFRESHED: 0 });

  return { results, summary, outcome: contactDiscoveryOutcome(summary) };
}

module.exports = {
  MAX_SELECTED_CONTACTS,
  DEFAULT_WEBSITE_RESEARCH_TIMEOUT_MS,
  discoverPublicContact,
  discoverSelectedContacts,
  isPublicEmailCandidate,
  normalizeContactLimit,
  normalizeResearchTimeout,
  knownCapabilityEvidence,
  mergeCapabilityVerifications,
  capabilityEvidenceVerification,
  contactDiscoveryOutcome,
  websiteResearchPrompt,
};
