// analyze-fit.mjs — CapGen Phase 2
// POST { opportunityId, force?, deep? }
// Two-stage Claude analysis with Supabase caching and OTP-session auth.

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Supabase helpers ─────────────────────────────────────────────────────────

function sbH(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbH() });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, row, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbH({ Prefer: `resolution=merge-duplicates,return=representation` }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table}: ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ── Auth: decode OTP session token ───────────────────────────────────────────

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const raw  = authHeader.slice(7);
    const data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!data.email || !data.ts) return null;
    // 8-hour session window
    if (Date.now() - data.ts > 8 * 60 * 60 * 1000) return null;
    return data.email.toLowerCase().trim();
  } catch {
    return null;
  }
}

// ── Claude API call ──────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userMessage, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data  = await res.json();
  const text  = (data.content?.[0]?.text || '').trim();
  const usage = data.usage || {};

  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Retry instruction appended — caller handles the retry
    throw new Object({ retryable: true, raw: text, usage });
  }

  return { parsed, usage };
}

async function callClaudeWithRetry(system, user, maxTokens) {
  try {
    return await callClaude(system, user, maxTokens);
  } catch (e) {
    if (e && e.retryable) {
      // One retry with explicit JSON instruction
      const retryUser = user + '\n\nReturn ONLY valid JSON. No prose, no fences.';
      return await callClaude(system, retryUser, maxTokens);
    }
    throw e;
  }
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const STAGE1_SYSTEM = `You are CapGen's federal contract fit analyst. You assess whether a specific
small business contractor should pursue a specific federal opportunity.
Be direct and honest — a wrong BID recommendation costs the contractor weeks
of wasted proposal effort. NO_BID is a valid and often correct answer.
Respond with ONLY a single valid JSON object. No markdown, no code fences,
no commentary before or after the JSON.`;

const STAGE2_SYSTEM = `You are CapGen's federal proposal strategist. The contractor has decided to
evaluate this opportunity seriously. Produce a concrete, actionable pursuit
package. Be specific to THIS opportunity and THIS contractor — no generic
boilerplate. Respond with ONLY a single valid JSON object. No markdown,
no code fences, no commentary.`;

function buildProfileBlock(p) {
  return `CONTRACTOR PROFILE:
Company: ${p.business_name || 'Unknown'}
UEI: ${p.uei || 'N/A'} | CAGE: ${p.cage || 'N/A'}
NAICS codes: ${(p.naics || []).join(', ') || 'None listed'}
Set-aside statuses: ${(p.set_asides || []).join(', ') || 'None listed'}
Certifications: ${JSON.stringify(p.certifications || [])}
Team size: ${p.team_size || 'Not specified'}
Capabilities: ${p.capabilities || 'Not specified'}
Past performance: ${p.past_performance || 'Not specified'}
Keywords: ${(p.keywords || []).join(', ') || 'None'}`;
}

function buildOppBlock(o) {
  const raw   = o.raw || {};
  const desc  = (raw.description || raw.fullParentPathName || '')
                  .toString().slice(0, 6000);
  const pop   = raw.placeOfPerformance?.city?.name
              ? `${raw.placeOfPerformance.city.name}, ${raw.placeOfPerformance.state?.code || ''}`
              : 'Not specified';
  return `OPPORTUNITY:
Title: ${o.title || 'Unknown'}
Agency: ${o.agency || 'Unknown'}
Notice ID: ${o.notice_id}
NAICS: ${o.naics_code || 'Not specified'}
Set-aside: ${o.set_aside || 'Unrestricted'}
Response deadline: ${o.response_deadline || 'Not specified'}
Place of performance: ${pop}
Description: ${desc || 'Not provided'}`;
}

const STAGE1_SCHEMA = `Return JSON matching exactly this schema:
{
  "opportunity_summary": "3-4 sentence plain-English summary of what the government is buying",
  "match": {
    "naics_match": true,
    "naics_detail": "1-2 sentences",
    "set_aside_eligible": true,
    "set_aside_detail": "1-2 sentences",
    "capability_alignment": "HIGH",
    "capability_detail": "2-3 sentences"
  },
  "recommendation": "BID",
  "fit_score": 85,
  "rationale": "3-5 sentences explaining the recommendation",
  "conditions": []
}`;

const STAGE2_SCHEMA = `Return JSON matching exactly this schema:
{
  "required_work": ["bullet list of the actual work scope items"],
  "staffing_delivery": ["roles, certifications, clearances, delivery requirements"],
  "documents_needed": ["every document required to respond"],
  "proposal_checklist": [{"item": "...", "owner_hint": "...", "deadline_hint": "..."}],
  "draft_technical_approach": "4-6 paragraph draft technical approach tailored to the contractor",
  "pricing_considerations": ["contract type implications, competitive range factors, cost drivers"],
  "questions_for_co": ["specific, well-formed questions for the contracting officer"]
}`;

// ── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  // Auth
  const accountEmail = verifyToken(event.headers?.authorization || event.headers?.Authorization || '');
  if (!accountEmail) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { opportunityId, force = false, deep = false } = body;
  if (!opportunityId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'opportunityId required' }) };

  // 1. Load profile
  const profiles = await sbGet(`capgen_subscriptions?email=eq.${encodeURIComponent(accountEmail)}&limit=1`);
  if (!profiles.length) {
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: 'PROFILE_REQUIRED' }) };
  }
  const profile = profiles[0];

  // 2. Cache check
  if (!force) {
    const cached = await sbGet(
      `opportunity_analyses?account_email=eq.${encodeURIComponent(accountEmail)}&opportunity_id=eq.${encodeURIComponent(opportunityId)}&profile_version=eq.${profile.profile_version}&limit=1`
    );
    if (cached.length) {
      const row = cached[0];
      if (!deep || row.stage2) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ...row, cached: true }) };
      }
      // deep=true but stage2 is null → fall through to run Stage 2 only
      // (handled below after Stage 1 block)
      const partialRow = row;

      // 3. Load opportunity for Stage 2 prompt
      let opp;
      const opps2 = await sbGet(`sam_opportunities?notice_id=eq.${encodeURIComponent(opportunityId)}&limit=1`);
      if (opps2.length) {
        opp = opps2[0];
      } else if (body.opportunity) {
        const inline = body.opportunity;
        opp = { notice_id: opportunityId, title: inline.title || '', agency: inline.agency || '',
                naics_code: inline.naics || '', set_aside: inline.set_aside || '',
                response_deadline: inline.deadline || '', raw: {} };
      } else {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Opportunity not found' }) };
      }

      const profileBlock = buildProfileBlock(profile);
      const oppBlock     = buildOppBlock(opp);
      const stage2User   = `${profileBlock}\n\n${oppBlock}\n\nSTAGE 1 ANALYSIS:\n${JSON.stringify(partialRow.stage1, null, 2)}\n\n${STAGE2_SCHEMA}`;

      let stage2, s2Usage;
      try {
        const r2 = await callClaudeWithRetry(STAGE2_SYSTEM, stage2User, 3000);
        stage2   = r2.parsed;
        s2Usage  = r2.usage;
      } catch (err) {
        return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'GENERATION_FAILED', detail: err.message }) };
      }

      const updated = await sbUpsert('opportunity_analyses', {
        account_email:   accountEmail,
        opportunity_id:  opportunityId,
        profile_version: profile.profile_version,
        stage1:          partialRow.stage1,
        stage2,
        recommendation:  partialRow.recommendation,
        fit_score:       partialRow.fit_score,
        model:           MODEL,
        input_tokens:    (partialRow.input_tokens || 0) + (s2Usage.input_tokens || 0),
        output_tokens:   (partialRow.output_tokens || 0) + (s2Usage.output_tokens || 0),
      });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ...updated, cached: false }) };
    }
  }

  // 3. Daily limit check (50 fresh analyses per 24h per account)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await sbGet(
    `opportunity_analyses?account_email=eq.${encodeURIComponent(accountEmail)}&created_at=gte.${encodeURIComponent(since)}&select=id`
  );
  if (recent.length >= 50) {
    const resetAt = new Date(new Date(recent[0]?.created_at || since).getTime() + 24 * 60 * 60 * 1000);
    const hoursLeft = Math.ceil((resetAt - Date.now()) / 3600000);
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'DAILY_LIMIT', hoursLeft }) };
  }

  // 4. Load opportunity — try Supabase first, fall back to inline data from request
  let opp;
  const opps = await sbGet(`sam_opportunities?notice_id=eq.${encodeURIComponent(opportunityId)}&limit=1`);
  if (opps.length) {
    opp = opps[0];
  } else if (body.opportunity) {
    // Caller passed the opportunity data directly (live pipeline opp not yet in sam_opportunities)
    const inline = body.opportunity;
    opp = {
      notice_id:         opportunityId,
      title:             inline.title || '',
      agency:            inline.agency || '',
      naics_code:        inline.naics || '',
      set_aside:         inline.set_aside || '',
      response_deadline: inline.deadline || '',
      raw:               {},
    };
  } else {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Opportunity not found' }) };
  }

  const profileBlock = buildProfileBlock(profile);
  const oppBlock     = buildOppBlock(opp);

  // 5. Stage 1
  const stage1User = `${profileBlock}\n\n${oppBlock}\n\n${STAGE1_SCHEMA}`;
  let stage1, s1Usage;
  try {
    const r1 = await callClaudeWithRetry(STAGE1_SYSTEM, stage1User, 1200);
    stage1   = r1.parsed;
    s1Usage  = r1.usage;
  } catch (err) {
    console.error('[analyze-fit] Stage 1 failed:', err.message || err);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'GENERATION_FAILED', detail: String(err.message || err) }) };
  }

  const recommendation = stage1.recommendation || 'NO_BID';
  const fitScore       = stage1.fit_score || 0;

  // 6. Stage 2 gate
  let stage2 = null;
  let s2Usage = {};
  const runStage2 = deep || recommendation === 'BID' || recommendation === 'CONDITIONAL';
  if (runStage2) {
    const stage2User = `${profileBlock}\n\n${oppBlock}\n\nSTAGE 1 ANALYSIS:\n${JSON.stringify(stage1, null, 2)}\n\n${STAGE2_SCHEMA}`;
    try {
      const r2 = await callClaudeWithRetry(STAGE2_SYSTEM, stage2User, 3000);
      stage2   = r2.parsed;
      s2Usage  = r2.usage;
    } catch (err) {
      // Stage 2 failure is non-fatal — return Stage 1 result with stage2=null
      console.error('[analyze-fit] Stage 2 failed (non-fatal):', err.message || err);
    }
  }

  // 7. Persist
  let saved;
  try {
    saved = await sbUpsert('opportunity_analyses', {
      account_email:   accountEmail,
      opportunity_id:  opportunityId,
      profile_version: profile.profile_version,
      stage1,
      stage2,
      recommendation,
      fit_score:     fitScore,
      model:         MODEL,
      input_tokens:  (s1Usage.input_tokens || 0) + (s2Usage.input_tokens || 0),
      output_tokens: (s1Usage.output_tokens || 0) + (s2Usage.output_tokens || 0),
    });
  } catch (err) {
    console.error('[analyze-fit] Persist failed:', err.message);
    // Return result even if persist fails
    saved = { account_email: accountEmail, opportunity_id: opportunityId, profile_version: profile.profile_version, stage1, stage2, recommendation, fit_score: fitScore, model: MODEL };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ...saved, cached: false }) };
};
