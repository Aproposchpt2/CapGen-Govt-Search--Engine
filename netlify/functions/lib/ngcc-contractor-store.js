'use strict';

const crypto = require('node:crypto');
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  SESSION_SECRET,
  sbHeaders,
  hmacHex,
} = require('./ngcc-ops');

const RUNS = 'ngcc_search_runs';
const CANDIDATES = 'ngcc_contractor_candidates';
const AGENTS = 'ngcc_contact_discovery_agents';
const STEPS = 'ngcc_procurement_mission_steps';
const MISSIONS = 'ngcc_procurement_missions';
const EVENTS = 'ngcc_procurement_mission_events';
const nowIso = () => new Date().toISOString();
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];

function ensureDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('NGCC operational database configuration is incomplete.');
}

async function db(table, method = 'GET', query = '', body, prefer = '') {
  ensureDb();
  const response = await fetch(`${String(SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/${table}${query}`, {
    method,
    headers: { ...sbHeaders(), ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${table} ${method} failed: ${response.status} ${text.slice(0, 500)}`);
  }
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function candidateKey(candidate = {}) {
  const uei = clean(candidate.ueiSAM || candidate.uei || candidate.uei_sam);
  if (uei) return uei;
  const cage = clean(candidate.cageCode || candidate.cage_code);
  if (cage) return cage;
  const business = clean(candidate.business_name || candidate.businessName).toUpperCase();
  const state = clean(candidate.state).toUpperCase();
  return `NAME:${crypto.createHash('sha256').update(`${business}|${state}`).digest('hex').slice(0, 32)}`;
}

function dbRowToCandidate(row = {}) {
  const snap = row.sam_entity_snapshot && typeof row.sam_entity_snapshot === 'object' ? row.sam_entity_snapshot : {};
  return {
    ...snap,
    candidate_id: row.candidate_id,
    search_run_id: row.search_run_id,
    candidate_key: row.candidate_key,
    ueiSAM: row.uei_sam || snap.ueiSAM || snap.uei || '',
    uei: row.uei_sam || snap.uei || snap.ueiSAM || '',
    cageCode: row.cage_code || snap.cageCode || snap.cage_code || '',
    cage_code: row.cage_code || snap.cage_code || snap.cageCode || '',
    businessName: row.business_name || snap.businessName || snap.business_name || '',
    business_name: row.business_name || snap.business_name || snap.businessName || '',
    city: row.city || snap.city || '',
    state: row.state || snap.state || '',
    registration_status: row.registration_status || snap.registration_status || '',
    registered_naics: arr(row.registered_naics),
    registered_pscs: arr(row.registered_pscs),
    business_classifications: arr(row.business_classifications),
    matched_search_paths: arr(row.matched_search_paths),
    rank: row.qualification_rank ?? row.discovery_rank ?? snap.rank ?? null,
    discovery_rank: row.discovery_rank,
    discovery_match_score: row.discovery_match_score == null ? null : Number(row.discovery_match_score),
    discovery_match_status: row.discovery_match_status,
    qualification_rank: row.qualification_rank,
    qualification_score: row.qualification_score == null ? null : Number(row.qualification_score),
    contract_qualification_score: row.qualification_score == null ? null : Number(row.qualification_score),
    qualification_status: row.qualification_status,
    evidence_coverage_percentage: row.evidence_coverage_percentage,
    confidence: row.qualification_confidence,
    capability_verification: row.capability_verification || null,
    explanation: row.qualification_explanation || {},
    operator_selected: Boolean(row.operator_selected),
    operator_disposition: row.operator_disposition,
    official_website_url: row.official_website_url,
    website_pages_checked: arr(row.website_pages_checked),
    contact_name: row.contact_name,
    contact_role: row.contact_role,
    contact_email: row.contact_email,
    source_url: row.contact_source_url,
    contact_source_url: row.contact_source_url,
    source_type: row.contact_source_type,
    contact_status: row.contact_status,
    contact_verified: Boolean(row.contact_verified),
    research_status: row.research_status,
    research_error: row.research_error,
    outreach_approved: Boolean(row.outreach_approved),
  };
}

async function loadMission(missionId) {
  const rows = await db(MISSIONS, 'GET', `?id=eq.${encodeURIComponent(missionId)}&select=*&limit=1`);
  if (!rows?.[0]) throw new Error('NGCC procurement mission was not found.');
  return rows[0];
}

async function currentRun(missionId) {
  const rows = await db(RUNS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&is_current=eq.true&select=*&order=run_number.desc&limit=1`);
  return rows?.[0] || null;
}

async function startSearchRun({ missionId, samNoticeId, businessSearchDna }) {
  const mission = await loadMission(missionId);
  const noticeId = clean(samNoticeId || mission.sam_notice_id);
  if (!noticeId) throw new Error('SAM notice ID is required for a contractor search run.');
  await db(RUNS, 'PATCH', `?mission_id=eq.${encodeURIComponent(missionId)}&is_current=eq.true`, { is_current: false, updated_at: nowIso() }, 'return=minimal');
  const prior = await db(RUNS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&select=run_number&order=run_number.desc&limit=1`);
  const runNumber = Number(prior?.[0]?.run_number || 0) + 1;
  const rows = await db(RUNS, 'POST', '', [{
    mission_id: missionId,
    sam_notice_id: noticeId,
    run_number: runNumber,
    is_current: true,
    status: 'RUNNING',
    business_search_dna: businessSearchDna || {},
    started_at: nowIso(),
  }], 'return=representation');
  if (!rows?.[0]) throw new Error('NGCC contractor search run could not be created.');
  return rows[0];
}

async function updateSearchRun(runId, patch) {
  const rows = await db(RUNS, 'PATCH', `?id=eq.${encodeURIComponent(runId)}`, { ...patch, updated_at: nowIso() }, 'return=representation');
  return rows?.[0] || null;
}

async function persistDiscoveryCandidates(run, candidates) {
  const rows = arr(candidates).map((candidate, index) => ({
    mission_id: run.mission_id,
    search_run_id: run.id,
    sam_notice_id: run.sam_notice_id,
    candidate_key: candidateKey(candidate),
    uei_sam: clean(candidate.ueiSAM || candidate.uei) || null,
    cage_code: clean(candidate.cageCode || candidate.cage_code) || null,
    business_name: clean(candidate.businessName || candidate.business_name) || 'UNKNOWN',
    city: clean(candidate.city) || null,
    state: clean(candidate.state).toUpperCase() || null,
    registration_status: clean(candidate.registration_status) || null,
    registered_naics: arr(candidate.registered_naics),
    registered_pscs: arr(candidate.registered_pscs),
    business_classifications: arr(candidate.business_classifications),
    matched_search_paths: arr(candidate.matched_search_paths),
    sam_entity_snapshot: candidate,
    discovery_rank: Number(candidate.discovery_rank || candidate.rank || index + 1),
    operator_selected: Boolean(candidate.operator_selected),
    operator_disposition: clean(candidate.operator_disposition) || 'PENDING',
    contact_status: 'NOT_RESEARCHED',
    research_status: 'NOT_STARTED',
  }));
  if (!rows.length) return [];
  const persisted = await db(CANDIDATES, 'POST', '?on_conflict=search_run_id,candidate_key', rows, 'resolution=merge-duplicates,return=representation');
  return arr(persisted).map(dbRowToCandidate);
}

async function listCandidates({ missionId, searchRunId, selectedOnly = false, verifiedOnly = false } = {}) {
  let query = '?select=*';
  if (searchRunId) query += `&search_run_id=eq.${encodeURIComponent(searchRunId)}`;
  else if (missionId) query += `&mission_id=eq.${encodeURIComponent(missionId)}`;
  if (selectedOnly) query += '&operator_selected=eq.true';
  if (verifiedOnly) query += '&contact_verified=eq.true';
  query += '&order=qualification_rank.asc.nullslast,discovery_rank.asc.nullslast,created_at.asc';
  const rows = await db(CANDIDATES, 'GET', query);
  return arr(rows).map(dbRowToCandidate);
}

async function persistQualifications(searchRunId, ranked) {
  const existing = await db(CANDIDATES, 'GET', `?search_run_id=eq.${encodeURIComponent(searchRunId)}&select=candidate_id,candidate_key,uei_sam,cage_code,business_name,state`);
  const byKey = new Map();
  for (const row of arr(existing)) {
    byKey.set(row.candidate_key, row);
    if (row.uei_sam) byKey.set(row.uei_sam, row);
    if (row.cage_code) byKey.set(row.cage_code, row);
  }
  await Promise.all(arr(ranked).map(async (candidate, index) => {
    const row = byKey.get(candidateKey(candidate));
    if (!row) return;
    const score = candidate.contract_qualification_score ?? candidate.qualification_score ?? null;
    await db(CANDIDATES, 'PATCH', `?candidate_id=eq.${encodeURIComponent(row.candidate_id)}`, {
      discovery_rank: Number(candidate.discovery_rank || candidate.rank || index + 1),
      discovery_match_score: candidate.discovery_match_score ?? null,
      discovery_match_status: candidate.discovery_match_status || null,
      qualification_rank: Number(candidate.rank || candidate.qualification_rank || index + 1),
      qualification_score: score,
      qualification_status: candidate.qualification_status || null,
      evidence_coverage_percentage: candidate.evidence_coverage_percentage ?? null,
      qualification_confidence: candidate.confidence || null,
      capability_verification: candidate.capability_verification || {},
      qualification_explanation: candidate.explanation || {},
      sam_entity_snapshot: candidate,
      updated_at: nowIso(),
    }, 'return=minimal');
  }));
  return listCandidates({ searchRunId });
}

async function setSelectedCandidates(searchRunId, identities, limit = 5) {
  const wanted = new Set(arr(identities).map(value => clean(typeof value === 'object' ? (value.candidate_id || value.ueiSAM || value.uei || value.cageCode || value.cage_code) : value)).filter(Boolean));
  const rows = await db(CANDIDATES, 'GET', `?search_run_id=eq.${encodeURIComponent(searchRunId)}&select=*`);
  const chosen = arr(rows).filter(row => wanted.has(row.candidate_id) || wanted.has(row.uei_sam) || wanted.has(row.cage_code) || wanted.has(row.candidate_key)).slice(0, Math.max(1, Math.min(Number(limit || 5), 5)));
  await db(CANDIDATES, 'PATCH', `?search_run_id=eq.${encodeURIComponent(searchRunId)}`, { operator_selected: false, updated_at: nowIso() }, 'return=minimal');
  if (chosen.length) {
    await Promise.all(chosen.map(row => db(CANDIDATES, 'PATCH', `?candidate_id=eq.${encodeURIComponent(row.candidate_id)}`, { operator_selected: true, updated_at: nowIso() }, 'return=minimal')));
  }
  return listCandidates({ searchRunId, selectedOnly: true });
}

async function nextContactAttempt(searchRunId) {
  const rows = await db(AGENTS, 'GET', `?search_run_id=eq.${encodeURIComponent(searchRunId)}&select=attempt_number&order=attempt_number.desc&limit=1`);
  return Number(rows?.[0]?.attempt_number || 0) + 1;
}

async function createContactAgents({ missionId, searchRunId, candidates }) {
  const selected = arr(candidates).slice(0, 5);
  if (!selected.length) throw new Error('No persisted contractors are selected for website/contact discovery.');
  const attempt = await nextContactAttempt(searchRunId);
  const rows = selected.map((candidate, index) => ({
    mission_id: missionId,
    search_run_id: searchRunId,
    candidate_id: candidate.candidate_id,
    attempt_number: attempt,
    agent_slot: index + 1,
    agent_code: `CONTACT-${String(index + 1).padStart(2, '0')}`,
    status: 'READY',
    progress_percentage: 0,
    current_activity: `Ready to research ${candidate.business_name || candidate.businessName}`,
  }));
  const created = await db(AGENTS, 'POST', '', rows, 'return=representation');
  return { attempt_number: attempt, agents: created || [] };
}

async function listContactAgents({ searchRunId, attemptNumber } = {}) {
  let query = `?search_run_id=eq.${encodeURIComponent(searchRunId)}&select=*&order=agent_slot.asc`;
  if (attemptNumber) query += `&attempt_number=eq.${encodeURIComponent(attemptNumber)}`;
  else {
    const latest = await nextContactAttempt(searchRunId) - 1;
    if (latest > 0) query += `&attempt_number=eq.${encodeURIComponent(latest)}`;
  }
  return db(AGENTS, 'GET', query);
}

async function updateAgent(agentId, patch) {
  const rows = await db(AGENTS, 'PATCH', `?id=eq.${encodeURIComponent(agentId)}`, { ...patch, updated_at: nowIso() }, 'return=representation');
  return rows?.[0] || null;
}

async function updateCandidateContact(candidateId, result) {
  const verified = result?.contact_status === 'VERIFIED' && Boolean(clean(result?.contact_email));
  const rows = await db(CANDIDATES, 'PATCH', `?candidate_id=eq.${encodeURIComponent(candidateId)}`, {
    official_website_url: result?.official_website_url || null,
    website_pages_checked: arr(result?.website_pages_checked),
    contact_name: result?.contact_name || null,
    contact_role: result?.contact_role || null,
    contact_email: verified ? clean(result.contact_email).toLowerCase() : null,
    contact_source_url: result?.source_url || result?.contact_source_url || null,
    contact_source_type: result?.source_type || null,
    contact_status: result?.contact_status || (verified ? 'VERIFIED' : 'NOT_FOUND'),
    contact_verified: verified,
    research_status: result?.research_status || (verified ? 'SUCCESS' : 'NOT_FOUND'),
    research_error: result?.research_status === 'FAILED' ? (result?.evidence_note || 'Website/contact research failed.') : null,
    capability_verification: result?.capability_verification || {},
    outreach_approved: false,
    updated_at: nowIso(),
  }, 'return=representation');
  return rows?.[0] ? dbRowToCandidate(rows[0]) : null;
}

function agentTerminal(agent) {
  return ['SUCCESS', 'NOT_FOUND', 'FAILED', 'SKIPPED', 'ZERO_RESULT'].includes(clean(agent?.status).toUpperCase());
}

function summarizeAgents(agents) {
  const rows = arr(agents);
  const total = rows.length;
  const completed = rows.filter(agentTerminal).length;
  const progress = total ? Math.round(rows.reduce((sum, agent) => sum + Math.max(0, Math.min(100, Number(agent.progress_percentage || (agentTerminal(agent) ? 100 : 0)))), 0) / total) : 0;
  return {
    total,
    completed,
    progress_percentage: completed === total && total > 0 ? 100 : progress,
    all_terminal: total > 0 && completed === total,
    success: rows.filter(row => row.status === 'SUCCESS').length,
    not_found: rows.filter(row => row.status === 'NOT_FOUND' || row.status === 'ZERO_RESULT').length,
    failed: rows.filter(row => row.status === 'FAILED').length,
  };
}

async function updateContactStep(missionId, { status, progress, activity, summary, errorCode = null, errorMessage = null } = {}) {
  const now = nowIso();
  const stepRows = await db(STEPS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&step_code=eq.CONTACT_DISCOVERY&select=*&limit=1`);
  const step = stepRows?.[0];
  if (!step) throw new Error('CONTACT_DISCOVERY mission step was not found.');
  const patch = {
    status: status || step.status,
    progress_percentage: Math.max(0, Math.min(100, Number(progress ?? step.progress_percentage ?? 0))),
    current_activity: activity || step.current_activity,
    last_heartbeat_at: now,
    output_summary: summary || step.output_summary || {},
    error_code: errorCode,
    error_message: errorMessage,
    updated_at: now,
  };
  if (patch.status === 'RUNNING') {
    patch.started_at = step.started_at || now;
    patch.completed_at = null;
  }
  if (['SUCCESS', 'ZERO_RESULT', 'FAILED'].includes(patch.status)) patch.completed_at = now;
  await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(step.id)}`, patch, 'return=minimal');
  await db(MISSIONS, 'PATCH', `?id=eq.${encodeURIComponent(missionId)}`, {
    current_step: patch.status === 'SUCCESS' ? 'BUSINESS_OUTREACH' : 'CONTACT_DISCOVERY',
    overall_status: patch.status === 'FAILED' ? 'FAILED' : 'ACTIVE',
    completion_percentage: patch.status === 'SUCCESS' ? 75 : 63,
    next_required_action: patch.status === 'SUCCESS' ? 'Business Outreach' : 'Website & Contact Discovery',
    waiting_condition: null,
    updated_at: now,
    last_activity_at: now,
  }, 'return=minimal');
  if (patch.status === 'SUCCESS') {
    const next = await db(STEPS, 'GET', `?mission_id=eq.${encodeURIComponent(missionId)}&step_code=eq.BUSINESS_OUTREACH&select=*&limit=1`);
    if (next?.[0] && next[0].status === 'NOT_STARTED') {
      await db(STEPS, 'PATCH', `?id=eq.${encodeURIComponent(next[0].id)}`, { status: 'READY', progress_percentage: 0, current_activity: 'Awaiting operator execution', updated_at: now }, 'return=minimal');
    }
  }
}

async function recordEvent(missionId, eventType, summary, payload = {}) {
  await db(EVENTS, 'POST', '', [{
    mission_id: missionId,
    event_type: eventType,
    event_summary: summary,
    event_payload: payload,
    actor_type: 'SYSTEM',
  }], 'return=minimal');
}

function internalSignature(rawBody) {
  if (!SESSION_SECRET) throw new Error('AUTH_TOKEN_SECRET is unavailable for internal background authorization.');
  return hmacHex(SESSION_SECRET, `ngcc-contact-background:${rawBody}`);
}

function verifyInternalSignature(rawBody, supplied) {
  const expected = internalSignature(rawBody);
  const a = Buffer.from(clean(supplied), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  RUNS,
  CANDIDATES,
  AGENTS,
  db,
  nowIso,
  candidateKey,
  dbRowToCandidate,
  loadMission,
  currentRun,
  startSearchRun,
  updateSearchRun,
  persistDiscoveryCandidates,
  listCandidates,
  persistQualifications,
  setSelectedCandidates,
  createContactAgents,
  listContactAgents,
  updateAgent,
  updateCandidateContact,
  agentTerminal,
  summarizeAgents,
  updateContactStep,
  recordEvent,
  internalSignature,
  verifyInternalSignature,
};