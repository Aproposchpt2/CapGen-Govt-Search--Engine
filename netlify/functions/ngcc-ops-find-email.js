// NGCC ops — find a real public contact email for a SAM-registered
// contractor, by searching the business's own website with an AI agent.
// Note: this repo already has enricher-hunter.js, which finds emails via
// Hunter.io domain search for its own bulk-campaign pipeline
// (contractors/contractor_contacts tables). This function is deliberately
// separate — it serves the per-contract ops tool (ngcc_outreach_events),
// not the general campaign — and uses a web-search AI agent instead of
// Hunter so it can also cover SAM registrants that were never imported
// into the bulk contractors table. Same never-invent-evidence discipline
// as BusinessContracts' enrichContact(): only returns an email actually
// published on an official source, with the source URL recorded.
'use strict';
const { json, opsGuard, OPENAI_KEY } = require('./lib/ngcc-ops');

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  if (!OPENAI_KEY) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
  const businessName = String(body.business_name || '').trim();
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  if (!businessName) return json(400, { ok: false, error: 'business_name is required.' });

  const location = [city, state].filter(Boolean).join(', ') || 'Unavailable';
  const prompt = `Find the current PUBLIC business contact email for "${businessName}", a company registered in SAM.gov, located in ${location}. Prefer business development, contracts, proposals, government sales, or a general contact address. Only return an email address actually published on the business's own official website or another official public source — never a guessed or pattern-generated address. Return only JSON: {"email":"","source_url":"","confidence":"HIGH|MEDIUM|LOW","evidence_note":""}. If no verifiable public email can be found, return {"email":null,"source_url":null,"confidence":"LOW","evidence_note":"explain why"}.`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        input: [
          { role: 'system', content: 'Use current public web sources. Return only valid JSON. Never invent an email address.' },
          { role: 'user', content: prompt },
        ],
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        max_output_tokens: 1200,
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenAI failed (${response.status}): ${raw.slice(0, 400)}`);
    const data = parseJsonText(extractResponseText(JSON.parse(raw)));
    const email = String(data.email || '').trim() || null;
    return json(200, {
      ok: true,
      business_name: businessName,
      email,
      source_url: data.source_url || null,
      confidence: data.confidence || (email ? 'MEDIUM' : 'LOW'),
      evidence_note: data.evidence_note || '',
    });
  } catch (error) {
    console.error('[ngcc-ops-find-email]', error.message);
    return json(200, { ok: false, error: error.message });
  }
};
