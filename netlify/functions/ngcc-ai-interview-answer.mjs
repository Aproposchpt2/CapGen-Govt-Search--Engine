// ngcc-ai-interview-answer.mjs -- 2026-08-18. Records one answer in an AI
// Interview session, verdicts it against the gap it targeted, and re-runs
// the fit assessment against the full picture so far -- a fresh, coherent
// re-assessment each time (original contract + profile + every answer given,
// not just the newest one), not an incremental patch that could drift.
// Standalone from the commercial Analyze Fit product -- see
// ngcc-ai-interview-start.mjs header.
//
// POST /api/ai-interview-answer { session_id, question_id, answer_text }
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
  const text = (data.content?.[0]?.text || '').trim();
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return { parsed: JSON.parse(clean), usage: data.usage || {} };
}

const SYSTEM = `You are updating a federal contract fit assessment based on a verification interview
with the contractor. You have the original plain-language explanation and assessment, and every
answer given in this interview so far including the newest one. Your job has two parts:

1. Verdict the newest answer specifically: CONFIRMED (requirement is met), DENIED (contractor does
   not meet it), PARTIAL (partially resolves it), or UNCLEAR.
2. Produce a fresh, complete, coherent re-assessment (recommendation, fit_score, rationale,
   conditions) incorporating the original facts AND every interview answer so far -- not a delta
   patch. If a DENY reveals a disqualifying gap, the recommendation and score must reflect that
   honestly, even if it means downgrading from the original assessment. Be as willing to revise
   upward as downward -- a confirmed capability the original assessment was uncertain about should
   improve the score just as a denied one should lower it.

Apply the same tribal/Native set-aside rule as the original assessment: if a set-aside requires
genuine Native American ownership/control and the contractor does not hold it, that cannot be
resolved through this interview -- treat it as a hard disqualifier, not a gap to close.

Respond with ONLY a single valid JSON object. No markdown, no commentary.`;

const SCHEMA = `Return JSON matching exactly this schema:
{
  "verdict": "CONFIRMED",
  "verdict_note": "1 sentence on what this answer establishes",
  "recommendation": "BID",
  "fit_score": 85,
  "rationale": "3-5 sentences reflecting the full picture including this interview",
  "conditions": ["remaining open items, if any"]
}`;

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });

    const body = await req.json().catch(() => ({}));
    const sessionId = safe(body.session_id, 80);
    const questionId = safe(body.question_id, 20);
    const answerText = safe(body.answer_text, 3000);
    if (!sessionId || !questionId || !answerText) {
      return json(400, { ok: false, error: 'session_id, question_id, and answer_text are required.' });
    }

    const rows = await db('ngcc_ai_interviews', 'GET', `?id=eq.${encodeURIComponent(sessionId)}&profile_intake_id=eq.${encodeURIComponent(session.intake_id)}&limit=1`);
    const interview = rows?.[0];
    if (!interview) return json(404, { ok: false, error: 'Interview session was not found.' });

    const question = (interview.questions || []).find(q => q.id === questionId);
    if (!question) return json(400, { ok: false, error: 'Unknown question_id for this session.' });

    const priorAnswers = Array.isArray(interview.answers) ? interview.answers : [];
    const newAnswer = { question_id: questionId, question_text: question.question_text, gap_type: question.gap_type, answer_text: answerText, answered_at: new Date().toISOString() };
    const transcriptSoFar = [...priorAnswers, newAnswer].map((a, i) => `Q${i + 1} (${a.gap_type}): ${a.question_text}\nA${i + 1}: ${a.answer_text}`).join('\n\n');

    const user = `PLAIN-LANGUAGE EXPLANATION:\n${JSON.stringify(interview.plain_language, null, 2)}\n\nORIGINAL ASSESSMENT:\nRecommendation: ${interview.original_recommendation}\nFit score: ${interview.original_fit_score}\nRationale: ${interview.original_rationale}\n\nINTERVIEW SO FAR (most recent answer is the one to verdict):\n${transcriptSoFar}\n\nMOST RECENT ANSWER TO VERDICT:\nQ: ${question.question_text}\nA: ${answerText}\n\n${SCHEMA}`;

    const { parsed, usage } = await callClaude(SYSTEM, user, 1500);
    newAnswer.verdict = parsed.verdict || 'UNCLEAR';
    newAnswer.verdict_note = parsed.verdict_note || '';
    const finalAnswers = [...priorAnswers, newAnswer];

    const answeredIds = new Set(finalAnswers.map(a => a.question_id));
    const remaining = (interview.questions || []).filter(q => !answeredIds.has(q.id));
    const newStatus = remaining.length ? 'in_progress' : 'awaiting_open_questions';

    const [updated] = await db('ngcc_ai_interviews', 'PATCH', `?id=eq.${encodeURIComponent(sessionId)}`, {
      answers: finalAnswers,
      revised_recommendation: parsed.recommendation,
      revised_fit_score: parsed.fit_score,
      revised_rationale: parsed.rationale,
      revised_conditions: parsed.conditions || [],
      status: newStatus,
      input_tokens: (interview.input_tokens || 0) + (usage.input_tokens || 0),
      output_tokens: (interview.output_tokens || 0) + (usage.output_tokens || 0),
      updated_at: new Date().toISOString(),
    }, 'return=representation');

    return json(200, {
      ok: true,
      verdict: newAnswer.verdict,
      verdict_note: newAnswer.verdict_note,
      original_fit_score: interview.original_fit_score,
      original_recommendation: interview.original_recommendation,
      revised_fit_score: updated.revised_fit_score,
      revised_recommendation: updated.revised_recommendation,
      revised_rationale: updated.revised_rationale,
      next_question: remaining[0] || null,
      interview_complete_pending_open_qa: !remaining.length,
    });
  } catch (error) {
    console.error('[ngcc-ai-interview-answer]', error);
    return json(500, { ok: false, error: 'The interview could not continue.' });
  }
}

export const config = {
  path: '/api/ai-interview-answer',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
