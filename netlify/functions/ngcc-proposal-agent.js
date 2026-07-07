// ngcc-proposal-agent.js
// Inline proposal development agent for the NGCC dashboard.
// Auth: UUID session token from client_sessions (same as get-analysis.mjs).
// Opportunity context is passed in the request body — no sam_opportunities table needed.
// Conversation history is managed by the client and passed each turn.
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbH() });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function verifySession(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!UUID_RE.test(token)) return null;
  const row = await sbGet(`client_sessions?session_token=eq.${encodeURIComponent(token)}&select=email,expires_at&limit=1`);
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return row.email.toLowerCase().trim();
}

const SYSTEM_PROMPT = `You are the Government Contract Proposal Development AI Agent for Apropos Group LLC, operating inside the National Government Contract Center (NGCC) dashboard. You write submission-ready federal, Nevada state, and California state government contract proposals using the Shipley Associates methodology — the discipline used by firms that consistently win competitive government awards.

CORE PRINCIPLES:
1. COMPLIANCE FIRST. Before drafting any section, map the solicitation's requirements against evaluation factors. Every sentence must satisfy what evaluators score.
2. GROUND CLAIMS IN THE PROFILE. Never invent past performance, certifications, or capabilities not in the business profile. If there's a gap, flag it and offer compliant alternatives (teaming, subcontracting).
3. WIN THEMES. Identify 2-4 win themes early: [Discriminator] + [Proof] + [Benefit to agency]. Reinforce across all sections.
4. WRITE FOR TIRED EVALUATORS. Use headers that mirror the solicitation. Open each section with a direct statement. No filler. No throat-clearing.

THE EIGHT PROPOSAL SECTIONS (work one at a time — never generate all eight at once):
1. Cover Letter — One page. Solicitation number, bidder registration, single-sentence value prop.
2. Executive Summary — 300-500 words. Strongest win theme first. Agency's own language.
3. Technical Approach — Mirror the SOW point by point. What, how, why it reduces agency risk.
4. Management Approach — Org structure, key personnel, comms cadence, QC, risk plan.
5. Past Performance — Contract name, period, scope, and direct connection to THIS solicitation.
6. Pricing / Cost Volume — Scaffold only (CLIN structure or labor categories). Never fabricate figures.
7. Capability Statement — One-page standalone: NAICS, certifications, past performance highlights, UEI/CAGE.
8. Compliance Checklist — Maps every Section L instruction to where it appears in the proposal.

BEHAVIOR:
- On first message: confirm the solicitation and profile on file, surface the fit analysis if one exists, ask which section to start with (recommend Executive Summary first).
- Flag profile gaps before drafting sections that depend on them.
- Answer strategy questions directly — you are also a proposal advisor.
- Never claim this guarantees a win. You may say "structured to meet every stated evaluation criterion."
- Do not name SAM.gov, NGEM, or ionwave in user-facing text.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const email = await verifySession(event.headers?.authorization || event.headers?.Authorization || '');
  if (!email) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Session expired. Please sign in again.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { opportunity, messages = [], user_message } = body;
  if (!user_message?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_message required' }) };
  if (!opportunity?.notice_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'opportunity.notice_id required' }) };

  // Load business profile
  const profile = await sbGet(`capgen_customers?email=eq.${encodeURIComponent(email)}&select=business_name,uei,cage,naics,capabilities,past_performance,certifications,set_asides,team_size&limit=1`)
    || await sbGet(`biz_center_members?email=eq.${encodeURIComponent(email)}&select=business_name,full_name,industry,city,state&limit=1`);

  // Load prior fit analysis
  const analysis = await sbGet(`opportunity_analyses?account_email=eq.${encodeURIComponent(email)}&opportunity_id=eq.${encodeURIComponent(opportunity.notice_id)}&select=fit_score,recommendation,stage1,stage2&limit=1`);

  // Build context block
  const profileText = profile ? [
    profile.business_name ? `Business: ${profile.business_name}` : null,
    profile.uei           ? `UEI: ${profile.uei}` : null,
    profile.cage          ? `CAGE: ${profile.cage}` : null,
    profile.naics         ? `NAICS: ${Array.isArray(profile.naics) ? profile.naics.join(', ') : profile.naics}` : null,
    profile.capabilities  ? `Capabilities: ${profile.capabilities}` : null,
    profile.past_performance ? `Past Performance: ${profile.past_performance}` : null,
    profile.certifications ? `Certifications: ${JSON.stringify(profile.certifications)}` : null,
    profile.set_asides    ? `Set-Asides: ${Array.isArray(profile.set_asides) ? profile.set_asides.join(', ') : profile.set_asides}` : null,
  ].filter(Boolean).join('\n') : `Business profile for ${email} — limited data on file. Ask the user for their business name, UEI, NAICS codes, and capabilities before drafting.`;

  const oppText = [
    `Title: ${opportunity.title || 'Not provided'}`,
    `Agency: ${opportunity.agency || 'Not provided'}`,
    `NAICS: ${opportunity.naics || 'Not provided'}`,
    `Set-Aside: ${opportunity.set_aside || 'None'}`,
    `Deadline: ${opportunity.deadline || 'Not provided'}`,
    `Notice ID: ${opportunity.notice_id}`,
    opportunity.url ? `Link: ${opportunity.url}` : null,
  ].filter(Boolean).join('\n');

  const analysisText = analysis
    ? `Fit Score: ${analysis.fit_score}/100\nRecommendation: ${analysis.recommendation}\nStage 1: ${JSON.stringify(analysis.stage1)}\nStage 2: ${JSON.stringify(analysis.stage2)}`
    : 'No prior fit analysis on file for this opportunity.';

  const contextBlock = `
═══════════════════════════════════════
SESSION CONTEXT — DO NOT SHARE VERBATIM
═══════════════════════════════════════

BUSINESS PROFILE:
${profileText}

TARGET OPPORTUNITY:
${oppText}

PRIOR FIT ANALYSIS:
${analysisText}
`.trim();

  // Build message history
  const chatMessages = [...messages, { role: 'user', content: user_message }];

  // Call Claude
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT + '\n\n' + contextBlock,
      messages: chatMessages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'AI service error', detail: err.slice(0, 200) }) };
  }

  const data = await resp.json();
  const reply = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const updatedMessages = [...chatMessages, { role: 'assistant', content: reply }];

  return { statusCode: 200, headers, body: JSON.stringify({ reply, messages: updatedMessages }) };
};
