'use strict';

const crypto = require('crypto');
const {
  SUPABASE_URL, SUPABASE_KEY, SAM_KEY, SESSION_SECRET, sbHeaders, hmacHex, sha256Hex,
} = require('./ngcc-ops');
const { searchSamOpportunities, requestDate } = require('./ngcc-sam-opportunities');

const WORKSPACE_TTL_SECONDS = 30 * 24 * 3600;

async function sb(table, method, query, body, prefer) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('NGCC operational database is not configured.');
  const headers = { ...sbHeaders() };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${String(SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/${table}${query || ''}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${table} ${method} ${response.status}: ${text.slice(0, 280)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const safe = value => String(value ?? '').trim();
const normalize = value => safe(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function claimReference(noticeId, email) {
  return `NG-${sha256Hex(`${safe(noticeId)}|${safe(email).toLowerCase()}`).slice(0, 8).toUpperCase()}`;
}

function issueWorkspaceToken(outreachId) {
  if (!SESSION_SECRET) throw new Error('AUTH_TOKEN_SECRET is not configured.');
  const exp = Math.floor(Date.now() / 1000) + WORKSPACE_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ outreach_id: outreachId, exp }), 'utf8').toString('base64url');
  const sig = hmacHex(SESSION_SECRET, `federal-workspace.${payload}`);
  return { token: `${payload}.${sig}`, expires_at: new Date(exp * 1000).toISOString() };
}

function verifyWorkspaceToken(token) {
  if (!SESSION_SECRET) return null;
  const [payload, sig] = safe(token).split('.');
  if (!payload || !sig) return null;
  const expected = hmacHex(SESSION_SECRET, `federal-workspace.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.outreach_id || !Number.isFinite(Number(decoded.exp))) return null;
    if (Number(decoded.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { outreach_id: String(decoded.outreach_id), exp: Number(decoded.exp) };
  } catch {
    return null;
  }
}

function searchWindow(postedDate) {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 364);
  let from = oneYearAgo;
  const parsed = postedDate ? new Date(postedDate) : null;
  if (parsed && !Number.isNaN(parsed.getTime()) && parsed > oneYearAgo) {
    from = new Date(parsed);
    from.setUTCDate(from.getUTCDate() - 2);
  }
  return { postedFrom: requestDate(from), postedTo: requestDate(today) };
}

async function loadSamOpportunity(noticeId, postedDate) {
  if (!SAM_KEY) throw new Error('SAM_API_KEY is not configured.');
  const window = searchWindow(postedDate);
  const batch = await searchSamOpportunities({
    apiKey: SAM_KEY,
    noticeId: safe(noticeId),
    postedFrom: window.postedFrom,
    postedTo: window.postedTo,
    limit: 10,
    offset: 0,
    activeOnly: false,
    userAgent: 'APROPOS-NGCC-Federal-Workspace/1.0',
    timeoutMs: 30000,
  });
  const opportunity = batch.rows.find(row => safe(row.noticeId) === safe(noticeId)) || batch.rows[0];
  if (!opportunity) throw new Error('The current SAM.gov opportunity record could not be refreshed.');
  return opportunity;
}

function publicSamUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('api_key');
    return parsed.toString();
  } catch {
    return String(url);
  }
}

function fetchableSamUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname === 'api.sam.gov' && SAM_KEY && !parsed.searchParams.get('api_key')) {
    parsed.searchParams.set('api_key', SAM_KEY);
  }
  return parsed.toString();
}

async function loadOutreachById(outreachId) {
  const rows = await sb('ngcc_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function loadOutreachForClaim(noticeId, email) {
  const rows = await sb('ngcc_outreach_events', 'GET', `?notice_id=eq.${encodeURIComponent(noticeId)}&contact_email=eq.${encodeURIComponent(safe(email).toLowerCase())}&select=*&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}

function opportunitySnapshot(outreach, sam) {
  const provider = outreach?.provider_payload || {};
  const pop = sam?.placeOfPerformance || {};
  return {
    notice_id: safe(outreach?.notice_id || sam?.noticeId) || null,
    solicitation_number: safe(sam?.solicitationNumber || provider.solicitation_number) || null,
    title: safe(sam?.title || outreach?.contract_title) || 'Federal contract opportunity',
    agency: safe(sam?.fullParentPathName || sam?.organizationName || sam?.department || outreach?.contract_agency) || null,
    naics: safe(sam?.naicsCode || outreach?.contract_naics) || null,
    response_deadline: sam?.reponseDeadLine || sam?.responseDeadLine || sam?.responseDeadline || outreach?.contract_deadline || null,
    posted_date: sam?.postedDate || provider.posted_date || null,
    set_aside: sam?.typeOfSetAsideDescription || sam?.setAside || null,
    sam_url: safe(sam?.uiLink || outreach?.contract_sam_url) || null,
    description_url: safe(sam?.description || provider.sam_description_url) || null,
    additional_info_url: safe(sam?.additionalInfoLink || provider.additional_info_url) || null,
    place_of_performance: pop,
    resource_links: (Array.isArray(sam?.resourceLinks) ? sam.resourceLinks : Array.isArray(provider.resource_links) ? provider.resource_links : []).filter(Boolean),
  };
}

module.exports = {
  WORKSPACE_TTL_SECONDS,
  sb,
  safe,
  normalize,
  claimReference,
  issueWorkspaceToken,
  verifyWorkspaceToken,
  loadSamOpportunity,
  publicSamUrl,
  fetchableSamUrl,
  loadOutreachById,
  loadOutreachForClaim,
  opportunitySnapshot,
};
