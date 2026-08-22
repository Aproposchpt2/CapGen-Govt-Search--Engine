// ngcc-ai-interview-open-qa.mjs -- 2026-08-18. The closing phase of the AI
// Interview: once the AI-driven targeted questions are done, the contractor
// gets the floor -- "Do you have any questions?" Answers are grounded in
// the plain-language explanation, the fit assessment, and the full
// verification interview transcript -- not a general-purpose chatbot.
// Standalone from the commercial Analyze Fit product -- see
// ngcc-ai-interview-start.mjs header.
//
// POST /api/ai-interview-open-qa { session_id, question } to ask.
// POST /api/ai-interview-open-qa { session_id, close: true } to end.
import { db, json, sameOrigin, env } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

const MODEL = env('ANALYZE_INTERVIEW_MODEL') || 'claude-sonnet-4-6';
const ANTHROPIC_KEY = env('ANTHROPIC_API_KEY');

function safe(v, n = 200) { return String(v ?? '').trim().slice(0, n); }

async function callClaude(system, user, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { text: (data.content?.[0]?.text || '').trim(), usage: data.usage || {} };
}

const SYSTEM = `You are answering a small business owner's follow-up question about a specific
federal contract they are deciding whether to pursue, at the close of a verification interview you
just conducted with them. Answer ONLY from what is actually provided below: the plain-language
contract explanation, the fit assessment, and the interview transcript. If the answer isn't contained
in any of those, say plainly that it isn't stated in the available material rather than guessing or
inferring. Be direct and concise -- a few sentences, not a report. Plain language, no jargon.`;

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });

    const body = await req.json().catch(() => ({}));
    const sessionId = safe(body.session_id, 80);
    if (!sessionId) return json(400, { ok: false, error: 'session_id is required.' });

    const rows = await db('ngcc_ai_interviews', 'GET', `?id=eq.${encodeURIComponent(sessionId)}&profile_intake_id=eq.${encodeURIComponent(session.intake_id)}&limit=1`);
    const interview = rows?.[0];
    if (!interview) return json(404, { ok: false, error: 'Interview session was not found.' });

    if (body.close === true) {
      const [updated] = await db('ngcc_ai_interviews', 'PATCH', `?id=eq.${encodeURIComponent(sessionId)}`, { status: 'complete', completed_at: new Date().toISOString() }, 'return=representation');
      return json(200, { ok: true, status: updated.status, completed_at: updated.completed_at });
    }

    const question = safe(body.question, 2000);
    if (!question) return json(400, { ok: false, error: 'question is required unless close:true.' });

    const transcript = (interview.answers || []).map((a, i) => `Q${i + 1}: ${a.question_text}\nA${i + 1}: ${a.answer_text} [${a.verdict}]`).join('\n\n');
    const priorOpenQa = (interview.open_qa || []).map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n');

    const user = `PLAIN-LANGUAGE EXPLANATION:\n${JSON.stringify(interview.plain_language, null, 2)}\n\nFIT ASSESSMENT (revised after interview):\nRecommendation: ${interview.revised_recommendation}\nFit score: ${interview.revised_fit_score}\nRationale: ${interview.revised_rationale}\n\nVERIFICATION INTERVIEW TRANSCRIPT:\n${transcript || '(no targeted questions were needed)'}\n\n${priorOpenQa ? `PRIOR OPEN Q&A THIS SESSION:\n${priorOpenQa}\n\n` : ''}CONTRACTOR'S QUESTION:\n${question}`;

    const { text, usage } = await callClaude(SYSTEM, user, 800);
    const newQa = { question, answer: text, answered_at: new Date().toISOString() };
    const updatedOpenQa = [...(interview.open_qa || []), newQa];

    await db('ngcc_ai_interviews', 'PATCH', `?id=eq.${encodeURIComponent(sessionId)}`, {
      open_qa: updatedOpenQa,
      status: 'awaiting_open_questions',
      input_tokens: (interview.input_tokens || 0) + (usage.input_tokens || 0),
      output_tokens: (interview.output_tokens || 0) + (usage.output_tokens || 0),
      updated_at: new Date().toISOString(),
    });

    return json(200, { ok: true, answer: text });
  } catch (error) {
    console.error('[rfcp-ai-interview-open-qa]', error);
    return json(500, { ok: false, error: 'The question could not be answered.' });
  }
}

export const config = {
  path: '/api/ai-interview-open-qa',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
