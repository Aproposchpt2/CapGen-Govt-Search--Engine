// ngcc-ai-interview-start.mjs -- 2026-08-18. Starts the AI Interview on the
// Registered Federal Contractors Portal, standalone -- NOT part of, and not
// dependent on, the commercial Analyze Fit product (that stays live only on
// the public-facing retired commercial sites; per Jeff, it is not part
// of the DHS proposal).
//
// Fast-dispatch pattern (fixed 2026-08-18 after a live test hit a 504
// Inactivity Timeout): this endpoint only creates a placeholder row and
// fires ngcc-ai-interview-start-background.mjs, returning immediately.
// The actual SAM.gov lookup + Claude call happens in that background
// function; the client polls this same endpoint (GET) until it's ready.
//
// POST /api/ai-interview-start { notice_id } -- create or resume, returns
//   immediately with status:'generating' if newly dispatched.
// GET  /api/ai-interview-start?session_id=... -- poll for current state.
import { db, json, sameOrigin, env } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

const SITE_URL = env('DEPLOY_URL') || env('URL') || '';

function safe(v, n = 200) { return String(v ?? '').trim().slice(0, n); }

function toClientShape(row) {
  const answeredIds = new Set((row.answers || []).map(a => a.question_id));
  const nextQuestion = (row.questions || []).find(q => !answeredIds.has(q.id)) || null;
  const plainLanguage = row.plain_language && Object.keys(row.plain_language).length ? row.plain_language : null;
  return {
    ok: true,
    session_id: row.id,
    status: row.status,
    plain_language: plainLanguage,
    opening_message: plainLanguage?._opening_message || null,
    questions: row.questions || [],
    answers: row.answers || [],
    open_qa: row.open_qa || [],
    next_question: (row.status === 'in_progress') ? nextQuestion : null,
    no_gaps_found: row.status === 'awaiting_open_questions' && !(row.answers || []).length,
    original_fit_score: row.original_fit_score,
    original_recommendation: row.original_recommendation,
    revised_fit_score: row.revised_fit_score,
    revised_recommendation: row.revised_recommendation,
  };
}

async function dispatchBackground(rowId, noticeId, verifiedProfile) {
  try {
    await fetch(`${SITE_URL}/.netlify/functions/ngcc-ai-interview-start-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rowId, noticeId, verifiedProfile }),
    });
  } catch (e) {
    console.error('[rfcp-ai-interview-start] background dispatch failed:', e.message);
  }
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });
    if (session.discovery_status !== 'verified') return json(409, { ok: false, error: 'Verify your business profile before starting the AI Interview.' });

    if (req.method === 'GET') {
      const requestUrl = new URL(req.url);
      const sessionId = safe(requestUrl.searchParams.get('session_id'), 80);
      if (!sessionId) return json(400, { ok: false, error: 'session_id is required.' });
      const rows = await db('ngcc_ai_interviews', 'GET', `?id=eq.${encodeURIComponent(sessionId)}&profile_intake_id=eq.${encodeURIComponent(session.intake_id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(404, { ok: false, error: 'Interview session was not found.' });
      return json(200, toClientShape(row));
    }

    const body = await req.json().catch(() => ({}));
    const noticeId = safe(body.notice_id, 80);
    if (!noticeId) return json(400, { ok: false, error: 'notice_id is required.' });

    const existing = await db('ngcc_ai_interviews', 'GET', `?profile_intake_id=eq.${encodeURIComponent(session.intake_id)}&opportunity_notice_id=eq.${encodeURIComponent(noticeId)}&order=created_at.desc&limit=1`);
    if (existing?.[0] && existing[0].status !== 'failed') {
      return json(200, { ...toClientShape(existing[0]), resumed: true });
    }

    const [row] = await db('ngcc_ai_interviews', 'POST', '', [{
      profile_intake_id: session.intake_id,
      opportunity_notice_id: noticeId,
      status: 'generating',
    }], 'return=representation');

    await dispatchBackground(row.id, noticeId, session.verified_profile || {});

    return json(200, { ...toClientShape(row), resumed: false });
  } catch (error) {
    console.error('[rfcp-ai-interview-start]', error);
    return json(500, { ok: false, error: 'The AI Interview could not be started.' });
  }
}

export const config = {
  path: '/api/ai-interview-start',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
