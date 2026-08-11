'use strict';

const { OPENAI_KEY } = require('./ngcc-ops');

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

async function discoverPublicContact(candidate = {}) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const businessName = String(candidate.business_name || candidate.businessName || '').trim();
  if (!businessName) throw new Error('Candidate business name is required.');
  const location = [candidate.city, candidate.state].filter(Boolean).join(', ') || 'Unavailable';
  const prompt = `Find the current PUBLIC business contact email for "${businessName}", a SAM.gov registered federal contractor located in ${location}.
Prefer a contact address for business development, contracts, proposals, government sales, capture, estimating, or a general business contact.
Only return an email actually published on the business's own official website or another official public source. Never guess, infer, construct, or pattern-generate an email.
Return only JSON:
{"email":"","contact_name":"","contact_role":"","source_url":"","confidence":"HIGH|MEDIUM|LOW","evidence_note":""}
If no verifiable public email can be found, return email=null, source_url=null, confidence="LOW", and explain why in evidence_note.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      input: [
        { role: 'system', content: 'Use current public web sources. Return only valid JSON. Never invent contact information. Source evidence is mandatory for a positive result.' },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      max_output_tokens: 1400,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI contact discovery failed (${response.status}): ${raw.slice(0, 400)}`);
  const parsed = parseJsonText(extractResponseText(JSON.parse(raw)));
  const email = isPublicEmailCandidate(parsed.email);
  const sourceUrl = String(parsed.source_url || '').trim() || null;
  const verified = Boolean(email && sourceUrl);
  return {
    uei: candidate.uei || candidate.ueiSAM || null,
    cage_code: candidate.cage_code || candidate.cageCode || null,
    business_name: businessName,
    city: candidate.city || null,
    state: candidate.state || null,
    qualification_rank: candidate.rank || null,
    qualification_score: candidate.qualification_score ?? null,
    qualification_status: candidate.qualification_status || null,
    operator_selected: true,
    contact_status: verified ? 'VERIFIED' : 'NOT_FOUND',
    contact_email: verified ? email : null,
    contact_name: verified ? (String(parsed.contact_name || '').trim() || null) : null,
    contact_role: verified ? (String(parsed.contact_role || '').trim() || null) : null,
    source_url: verified ? sourceUrl : null,
    confidence: verified ? String(parsed.confidence || 'MEDIUM').toUpperCase() : 'LOW',
    evidence_note: String(parsed.evidence_note || '').trim(),
    outreach_approved: false,
  };
}

async function discoverSelectedContacts(candidates = [], options = {}) {
  const selected = (Array.isArray(candidates) ? candidates : []).filter(candidate => candidate.operator_selected === true || candidate.operator_disposition === 'APPROVED');
  const max = Math.max(1, Math.min(Number(options.limit || 10), 20));
  const targets = selected.slice(0, max);
  const results = [];
  for (const candidate of targets) {
    try {
      results.push(await discoverPublicContact(candidate));
    } catch (error) {
      results.push({
        uei: candidate.uei || candidate.ueiSAM || null,
        cage_code: candidate.cage_code || candidate.cageCode || null,
        business_name: candidate.business_name || candidate.businessName || null,
        city: candidate.city || null,
        state: candidate.state || null,
        qualification_rank: candidate.rank || null,
        qualification_score: candidate.qualification_score ?? null,
        qualification_status: candidate.qualification_status || null,
        operator_selected: true,
        contact_status: 'FAILED',
        contact_email: null,
        contact_name: null,
        contact_role: null,
        source_url: null,
        confidence: 'LOW',
        evidence_note: String(error.message || error),
        outreach_approved: false,
      });
    }
  }
  const summary = results.reduce((acc, item) => {
    acc.total += 1;
    acc[item.contact_status] = (acc[item.contact_status] || 0) + 1;
    return acc;
  }, { total: 0, VERIFIED: 0, NOT_FOUND: 0, FAILED: 0 });
  return { results, summary };
}

module.exports = { discoverPublicContact, discoverSelectedContacts, isPublicEmailCandidate };
