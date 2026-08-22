// ngcc-ai-interview-start-background.mjs -- 2026-08-18. The actual work
// behind starting an AI Interview: SAM.gov lookup, description resolution,
// and the Claude call that produces the plain-language explanation +
// dynamic question set. Split out of ngcc-ai-interview-start.mjs because
// that chain (two external SAM.gov calls plus a ~3000-token Claude call)
// reliably exceeded the platform's synchronous response timeout on a live
// test run (confirmed: 504 Inactivity Timeout). Same fast-dispatch +
// background-function pattern already proven in this codebase by
// analyze-fit.mjs / analyze-fit-background.mjs.
//
// Invoked server-to-server only, by ngcc-ai-interview-start.mjs.
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SAM_API_KEY = process.env.SAM_API_KEY;
const MODEL = process.env.ANALYZE_INTERVIEW_MODEL || 'claude-sonnet-4-6';

function sbH(extra = {}) { return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra }; }
async function sbPatch(filter, update) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ngcc_ai_interviews?${filter}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(update), signal: AbortSignal.timeout(15000) });
  if (!res.ok) console.error('[bg] Supabase PATCH failed:', await res.text());
}

function buildProfileBlock(verified) {
  return `CONTRACTOR PROFILE:
Company: ${verified.business_name || verified.legal_name || 'Unknown'}
UEI: ${verified.uei || 'N/A'} | CAGE: ${verified.cage || 'N/A'}
Location: ${[verified.resident_city, verified.resident_state].filter(Boolean).join(', ') || 'Not specified'}
NAICS codes: ${(verified.naics_codes || []).join(', ') || 'None confirmed'}
Set-aside statuses: ${(verified.set_asides || []).join(', ') || 'None listed'}
Certifications: ${(verified.certifications || []).join(', ') || 'None listed'}
Team size: ${verified.team_size || 'Not specified'}
Services: ${(verified.services || []).join('; ') || 'Not specified'}
Products: ${(verified.products || []).join('; ') || 'Not specified'}
Capabilities: ${(verified.capabilities || []).join('; ') || 'Not specified'}
Core competencies: ${(verified.core_competencies || []).join('; ') || 'Not specified'}
Past performance: ${verified.past_performance || 'Not specified'}`;
}

const SAM_DESC_URL = 'https://api.sam.gov/prod/opportunities/v1/noticedesc';
function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim();
}
async function resolveDescription(noticeId) {
  if (!SAM_API_KEY || !noticeId) return null;
  try {
    const res = await fetch(`${SAM_DESC_URL}?noticeid=${encodeURIComponent(noticeId)}&api_key=${SAM_API_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return stripHtml(data.description || data.body || '') || null;
  } catch { return null; }
}

function buildOppBlock(o, resolvedDescription) {
  const desc = (resolvedDescription || '').slice(0, 6000);
  return `OPPORTUNITY:
Title: ${o.title || 'Unknown'}
Agency: ${o.agency || o.fullParentPathName || 'Unknown'}
Notice ID: ${o.noticeId || o.notice_id}
NAICS: ${o.naicsCode || o.naics_code || 'Not specified'}
Set-aside: ${o.typeOfSetAsideDescription || o.set_aside || 'Unrestricted'}
Response deadline: ${o.responseDeadLine || o.response_deadline || 'Not specified'}
Place of performance: ${o.placeOfPerformance?.city?.name ? `${o.placeOfPerformance.city.name}, ${o.placeOfPerformance.state?.code || ''}` : 'Not specified'}
Description: ${desc || 'Not provided'}`;
}

async function callClaude(system, user, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim();
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return { parsed: JSON.parse(clean), usage: data.usage || {} };
}

const SYSTEM = `You are conducting an AI Interview for a small business owner deciding whether to
pursue a specific federal contract. You do two things in this first message:

1. Write a plain-language explanation of the contract (Plain Writing Act standard: short sentences,
   active voice, no jargon). Base this strictly on the opportunity text given -- never infer or assume
   a fact that isn't stated, even if you recognize the agency or type of work.
2. Identify genuine verification gaps between what this contract requires and what this specific
   contractor's profile confirms, and generate 3 to 6 targeted questions to ask them directly -- only
   for gaps you can point to in the material provided, never a generic checklist. Categories: license
   or certification requirements, geographic/place-of-performance capability, set-aside eligibility,
   security clearance, bonding/insurance, past performance / reference count, staffing capacity for
   named roles, SAM.gov standing, timeline feasibility. Only include categories that actually apply to
   THIS contract. If the profile already clearly confirms something, do not ask about it again.

CRITICAL RULE -- TRIBAL AND NATIVE SET-ASIDES: if the opportunity requires tribal, Native American,
or Indian-specific set-aside status and the profile does not already show it, do not suggest the
contractor pursue or verify obtaining it -- state plainly that this cannot be acquired for a specific
bid and the contractor is not eligible, do not turn it into a question.

Respond with ONLY a single valid JSON object. No markdown, no commentary.`;

const SCHEMA = `Return JSON matching exactly this schema:
{
  "plain_language": {
    "opportunity_summary": "3-4 sentence plain-English summary of what the government is buying",
    "what_youd_deliver": "2-4 sentence plain-English description of the actual scope of work",
    "key_dates": [{"label": "Response due", "value": "..."}],
    "how_theyll_choose": "1-2 sentences on how the winner is selected, or state it isn't specified",
    "not_specified_in_listing": ["things a bidder would want to know that aren't stated"]
  },
  "initial_assessment": {
    "recommendation": "BID",
    "fit_score": 70,
    "rationale": "3-5 sentences",
    "conditions": ["open items, if any"]
  },
  "opening_message": "1-2 sentence plain-language message telling the contractor what happens next in this interview",
  "questions": [
    {"gap_type": "LICENSE_CERTIFICATION", "gap_source": "what triggered this, 1 sentence", "question_text": "the actual question to ask"}
  ]
}`;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { rowId, noticeId, verifiedProfile } = body;
  if (!rowId || !noticeId) return { statusCode: 400, body: 'rowId and noticeId required' };

  try {
    const samRes = await fetch(`https://api.sam.gov/opportunities/v2/search?api_key=${SAM_API_KEY}&noticeid=${encodeURIComponent(noticeId)}&limit=1`, { signal: AbortSignal.timeout(10000) });
    const samData = samRes.ok ? await samRes.json().catch(() => ({})) : {};
    const opp = samData.opportunitiesData?.[0];
    if (!opp) {
      await sbPatch(`id=eq.${rowId}`, { status: 'failed' });
      return { statusCode: 200, body: 'opportunity not found' };
    }

    const resolvedDescription = await resolveDescription(noticeId);
    const profileBlock = buildProfileBlock(verifiedProfile || {});
    const oppBlock = buildOppBlock(opp, resolvedDescription);
    const user = `${profileBlock}\n\n${oppBlock}\n\n${SCHEMA}`;

    const { parsed, usage } = await callClaude(SYSTEM, user, 3000);
    const questions = (parsed.questions || []).slice(0, 6).map((q, i) => ({ id: `q${i + 1}`, order: i + 1, ...q }));
    const initial = parsed.initial_assessment || {};

    await sbPatch(`id=eq.${rowId}`, {
      status: questions.length ? 'in_progress' : 'awaiting_open_questions',
      plain_language: { ...(parsed.plain_language || {}), _opening_message: parsed.opening_message || '' },
      questions,
      original_fit_score: initial.fit_score ?? null,
      original_recommendation: initial.recommendation || null,
      original_rationale: initial.rationale || null,
      original_conditions: initial.conditions || [],
      revised_fit_score: initial.fit_score ?? null,
      revised_recommendation: initial.recommendation || null,
      revised_rationale: initial.rationale || null,
      revised_conditions: initial.conditions || [],
      model: MODEL,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      updated_at: new Date().toISOString(),
    });

    return { statusCode: 200, body: 'complete' };
  } catch (error) {
    console.error('[rfcp-ai-interview-start-background]', error.message || error);
    try { await sbPatch(`id=eq.${rowId}`, { status: 'failed' }); } catch {}
    return { statusCode: 200, body: 'failed' };
  }
};
