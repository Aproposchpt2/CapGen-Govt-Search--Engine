// NGCC ops — derive the real matching NAICS code(s) from a contract's
// actual requirements text, per Jeff's stated workflow: "extract
// Requirements from the contracts > Derive the NAICS numbers that match
// the Contract requirements > then use the NAICS numbers to scan for the
// businesses." The single naicsCode SAM.gov attaches to a listing is often
// generic or imprecise -- this reads the real solicitation description
// (fetched fresh from SAM.gov, not the truncated/URL placeholder the
// opportunities search endpoint returns in its own "description" field)
// and has an AI agent confirm or correct the NAICS code(s) that actually
// match the described scope of work.
'use strict';
const { json, opsGuard, SAM_KEY, OPENAI_KEY } = require('./lib/ngcc-ops');

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchDescription(noticeId) {
  const url = `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${encodeURIComponent(noticeId)}&api_key=${SAM_KEY}`;
  const res = await fetch(url);
  if (!res.ok) { const t = await res.text(); throw new Error(`SAM description fetch ${res.status}: ${t.slice(0, 300)}`); }
  const data = await res.json().catch(() => null);
  // Shape not fully confirmed yet -- try the documented/likely field names
  // and fall back to treating the whole payload as text so a shape
  // mismatch surfaces as garbled text (visible, fixable) rather than a
  // silent empty result.
  const raw = data && (data.description || data.body || data.data) || (typeof data === 'string' ? data : JSON.stringify(data));
  return stripHtml(raw).slice(0, 6000);
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  for (const item of data?.output || []) {
    if (item?.type === 'message') for (const c of item.content || []) if (c?.type === 'output_text' && c.text) out.push(c.text);
  }
  return out.join('\n');
}
function parseJsonText(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('AI response did not contain valid JSON.');
}

async function deriveNaics({ title, agency, samNaicsCode, description }) {
  const prompt = `Government contract solicitation:
Title: ${title}
Agency: ${agency || 'Unavailable'}
SAM.gov-assigned NAICS code: ${samNaicsCode || 'Unavailable'}
Actual requirements/description text:
${description || '(No description text was available -- work only from the title and agency.)'}

Based on the actual scope of work described above, identify the NAICS code(s) that genuinely match the work required -- not just the code SAM.gov happened to assign, which is sometimes generic or a poor fit. Return only JSON:
{"primary_naics":"","confirms_sam_code":true|false,"additional_naics":[],"rationale":""}
- primary_naics: the single best-fit 6-digit NAICS code for the primary scope of work.
- confirms_sam_code: true if primary_naics matches the SAM.gov-assigned code, false if you're correcting it.
- additional_naics: 0-2 other 6-digit codes worth searching if the work spans multiple trades (empty array if none).
- rationale: one or two sentences explaining the match, referencing the actual work described.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      input: [
        { role: 'system', content: 'You are classifying government contracts by NAICS code from their real requirements text. Return only valid JSON. Never fabricate requirements not present in the text.' },
        { role: 'user', content: prompt },
      ],
      max_output_tokens: 800,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI failed (${response.status}): ${raw.slice(0, 400)}`);
  return parseJsonText(extractResponseText(JSON.parse(raw)));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  if (!OPENAI_KEY) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
  const noticeId = String(body.notice_id || '').trim();
  const title = String(body.title || '').trim();
  const agency = String(body.agency || '').trim();
  const samNaicsCode = String(body.naics_code || '').trim();
  if (!noticeId || !title) return json(400, { ok: false, error: 'notice_id and title are required.' });

  try {
    let description = '';
    let description_error = null;
    try { description = await fetchDescription(noticeId); }
    catch (e) { description_error = e.message; console.error('[ngcc-ops-derive-naics] description fetch failed:', e.message); }

    const derived = await deriveNaics({ title, agency, samNaicsCode, description });
    return json(200, {
      ok: true,
      sam_naics_code: samNaicsCode || null,
      primary_naics: derived.primary_naics || samNaicsCode || null,
      confirms_sam_code: Boolean(derived.confirms_sam_code),
      additional_naics: Array.isArray(derived.additional_naics) ? derived.additional_naics.filter(Boolean) : [],
      rationale: derived.rationale || '',
      description_used: Boolean(description),
      description_error,
    });
  } catch (error) {
    console.error('[ngcc-ops-derive-naics]', error.message);
    return json(200, { ok: false, error: error.message });
  }
};
