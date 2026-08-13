'use strict';

const { OPENAI_KEY } = require('./ngcc-ops');
const {
  candidateKey,
  contractVerificationProfile,
  emptyVerification,
  normalizeVerification,
} = require('./ngcc-contractor-capability-verification');

const MAX_SELECTED_CONTACTS = 5;
const DEFAULT_WEBSITE_RESEARCH_TIMEOUT_MS = 16000;

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

function websiteResearchPrompt(candidate = {}, contractDna = null) {
  const businessName = String(candidate.business_name || candidate.businessName || '').trim();
  const location = [candidate.city, candidate.state].filter(Boolean).join(', ') || 'Unavailable';
  const contract = contractDna && typeof contractDna === 'object' ? contractVerificationProfile(contractDna) : null;
  return `Perform WEBSITE-FIRST research for the federal contractor "${businessName}" located in ${location}.

REQUIRED RESEARCH SEQUENCE:
1. Locate the business's current OFFICIAL website. Distinguish it from directories, lead-generation pages, social profiles, and similarly named businesses.
2. Review the official website's current home, services/capabilities, about, contact, contracts/government, and footer pages when available.
3. Find a PUBLIC email actually published by the business. Prefer business development, contracts, proposals, government sales, capture, estimating, or a general business email.
4. If the official website does not publish an email, you may use another OFFICIAL PUBLIC AUTHORITY source that explicitly publishes the email. Never guess, infer, construct, or pattern-generate an address.
5. If CONTRACT context is supplied, use the official website and authoritative public sources to verify the business's CURRENT capability for that specific requirement. SAM/NAICS registration alone is discovery evidence, not proof of capability.
6. SUPPORTED or MISMATCH capability conclusions require a source URL. Missing or ambiguous evidence must remain UNVERIFIED.

BUSINESS:\n${JSON.stringify({
    key: candidateKey(candidate),
    uei: candidate.uei || candidate.ueiSAM || null,
    cage_code: candidate.cage_code || candidate.cageCode || null,
    business_name: businessName,
    city: candidate.city || null,
    state: candidate.state || null,
    registered_naics: candidate.registered_naics || [],
  }, null, 2)}

CONTRACT:\n${contract ? JSON.stringify(contract, null, 2) : 'Not supplied — perform contact discovery only.'}

Return ONLY valid JSON in exactly this shape:
{
  "official_website_url":"https://... or null",
  "website_pages_checked":[{"url":"https://...","note":"what was checked"}],
  "email":"published email or null",
  "contact_name":"",
  "contact_role":"",
  "source_url":"URL where the email is visibly published or null",
  "source_type":"OFFICIAL_WEBSITE|OFFICIAL_PUBLIC_AUTHORITY|NONE",
  "confidence":"HIGH|MEDIUM|LOW",
  "evidence_note":"",
  "capability_verification": {
    "key":"candidate key exactly as supplied",
    "uei":"",
    "business_name":"",
    "status":"VERIFIED|PARTIAL|NOT_FOUND",
    "verified_at":"ISO-8601 timestamp",
    "sources":[{"url":"https://...","title":"","note":""}],
    "dimensions": {
      "current_capability_alignment":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
      "mandatory_requirements":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
      "certifications_licenses":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
      "past_performance":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
      "set_aside_classification":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
      "geography_capacity":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]},
      "supplier_role":{"status":"SUPPORTED|MISMATCH|UNVERIFIED","reason":"","sources":[]}
    }
  }
}
If CONTRACT context is not supplied, set capability_verification=null.`;
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
            content: 'Use current public web sources. Start with the business official website. Never invent contact information or capability evidence. Return only valid JSON.',
          },
          { role: 'user', content: websiteResearchPrompt(candidate, contractDna) },
        ],
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        max_output_tokens: contractDna ? 2800 : 1500,
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
    const rawVerification = contractDna && parsed.capability_verification && typeof parsed.capability_verification === 'object'
      ? normalizeVerification(parsed.capability_verification, candidate)
      : null;
    const capabilityVerification = rawVerification && knownCapabilityEvidence(rawVerification) ? rawVerification : null;

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

  return { results, summary };
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
  websiteResearchPrompt,
};
