// NGCC — shared helpers for the internal (non-public-facing) operator
// outreach tools: ngcc-ops-auth, ngcc-sam-entity-search, ngcc-ops-find-email,
// ngcc-ops-outreach, ngcc-unsubscribe.
//
// This is a DIFFERENT feature from send-contractor-outreach.js /
// import-active-contractors.js / enricher-hunter.js, which already exist in
// this repo and run a general "sign up for NGCC" campaign against a bulk
// SAM.gov import (contractors / contractor_contacts / email_batch tables).
// This tool instead matches ONE specific contract opportunity to real
// SAM-registered contractors and emails THAT opportunity to them, on
// demand, from a password-gated internal page — same shape as the
// BusinessContracts bulk-outreach feature. Separate tables
// (ngcc_outreach_events), separate functions, so it can't collide with the
// existing campaign machinery.
//
// Reuses existing site infrastructure rather than provisioning new secrets:
//   AUTH_TOKEN_SECRET  — already set on this site, unused elsewhere in the
//                        codebase as of 2026-08-09. Reused here as the HMAC
//                        key for both the ops session token and the
//                        unsubscribe link token.
//   MAILING_ADDRESS    — already set. Used in the outreach email footer for
//                        CAN-SPAM compliance.
//   RESEND_TO_EMAIL    — already set. Used as the TEST MODE recipient.
'use strict';

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SAM_KEY = process.env.SAM_API_KEY;
const SESSION_SECRET = process.env.AUTH_TOKEN_SECRET || '';
const OPS_PASSWORD = process.env.NGCC_OPS_PASSWORD || '';
const TEST_OPS_PASSWORD = process.env.NGCC_TEST_OPS_PASSWORD || '';
const TEST_OPS_EXPIRES_AT = process.env.NGCC_TEST_OPS_EXPIRES_AT || '';
const MAILING_ADDRESS = process.env.MAILING_ADDRESS || '';
const TEST_RECIPIENT = process.env.RESEND_TO_EMAIL || '';
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'NGCC <noreply@ai4businesses.org>';
const RESEND_KEY = process.env.RESEND_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SITE_ORIGIN = 'https://ngcc.aproposgroupllc.com';
const SESSION_TTL_SECONDS = 12 * 3600; // 12h — operator re-enters the password once per work session

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

function sbHeaders() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
}

// Same-origin check for the internal ops endpoints — this tool is never
// meant to be called cross-origin, unlike the existing public/campaign
// functions in this repo which intentionally use CORS *.
function sameOrigin(event) {
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || headers.referer || headers.Referer || '';
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.origin === SITE_ORIGIN || u.hostname === 'localhost';
  } catch { return false; }
}

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function sha256Hex(message) {
  return crypto.createHash('sha256').update(message).digest('hex');
}

function issueOpsSession({ role = 'operator', expiresAt } = {}) {
  const sessionExp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const fixedExp = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : sessionExp;
  const exp = Math.min(sessionExp, fixedExp);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Temporary operator access has expired.');
  }
  const safeRole = role === 'test_operator' ? 'test_operator' : 'operator';
  const sig = hmacHex(SESSION_SECRET, `ops.${safeRole}.${exp}`);
  return { token: `${exp}.${safeRole}.${sig}`, role: safeRole, expires_at: new Date(exp * 1000).toISOString() };
}

// Verifies the Authorization: Bearer <exp>.<hmac> header. Stateless — no DB
// round trip, so a leaked/expired token simply stops working at `exp`
// rather than needing a revocation list.
function verifyOpsSessionDetails(event) {
  const headers = event.headers || {};
  const header = headers.authorization || headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const parts = token.split('.');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [expStr, roleOrSig, versionedSig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  // Accept unexpired legacy operator tokens while moving new sessions to
  // explicit roles. Test sessions are always role-bound and time-limited.
  const role = parts.length === 2 ? 'operator' : roleOrSig;
  const sig = parts.length === 2 ? roleOrSig : versionedSig;
  if (!['operator', 'test_operator'].includes(role) || !sig) return null;
  const message = parts.length === 2 ? `ops.${exp}` : `ops.${role}.${exp}`;
  const expected = hmacHex(SESSION_SECRET, message);
  const suppliedBuffer = Buffer.from(sig, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  return { role, exp, expires_at: new Date(exp * 1000).toISOString() };
}

function verifyOpsSession(event) {
  return Boolean(verifyOpsSessionDetails(event));
}

function opsGuard(event, allowedRoles = ['operator', 'test_operator']) {
  if (!sameOrigin(event)) return json(403, { ok: false, error: 'Same-origin request required.' });
  const session = verifyOpsSessionDetails(event);
  if (!session) return json(401, { ok: false, error: 'Operator session required. Sign in again.' });
  if (!allowedRoles.includes(session.role)) return json(403, { ok: false, error: 'This operator role is not authorized for the requested action.' });
  return null;
}

// Public-tier SAM.gov Entity Management search, filtered by NAICS code.
// Confirmed against GSA's own API docs (2026-08-09): point-of-contact
// email/phone/fax only exist at the FOUO tier, which is not reachable with
// a non-federal Personal API Key — this deliberately only requests
// entityRegistration + coreData (public tier). Email is found separately,
// per-candidate, via ngcc-ops-find-email.js's web-search agent (this repo's
// existing enricher-hunter.js uses Hunter.io domain search instead, for its
// own, different bulk-campaign use case).
// Pagination: page + size (confirmed against GSA's own docs at
// https://open.gsa.gov/api/entity-api/ after start/length was tried first
// and rejected outright by SAM.gov's own API with "The search parameters,
// start, length do not exist" -- that first attempt was based on an
// unverified sibling file, not confirmed against this endpoint directly.
// Jeff confirmed 10-20 candidate businesses per contract is plenty -- no
// need to chase hundreds, so this stays at 2 pages of the documented
// default size rather than an aggressive multi-page loop.
const ENTITY_PAGE_SIZE = 10;
const ENTITY_MAX_PAGES = 2; // up to 20 entities per search

function mapEntity(e) {
  const reg = e.entityRegistration || {};
  const core = e.coreData || {};
  const addr = core.physicalAddress || core.mailingAddress || {};
  return {
    ueiSAM: reg.ueiSAM || '',
    businessName: reg.legalBusinessName || reg.entityName || '',
    cageCode: reg.cageCode || '',
    city: addr.city || '',
    state: addr.stateOrProvinceCode || '',
  };
}

async function fetchEntityPage({ naicsCode, state, page, size }) {
  const params = new URLSearchParams({
    api_key: SAM_KEY,
    naicsCode,
    registrationStatus: 'A',
    includeSections: 'entityRegistration,coreData',
    page: String(page),
    size: String(size),
  });
  if (state) params.set('physicalAddressProvinceOrStateCode', state);
  const res = await fetch(`https://api.sam.gov/entity-information/v3/entities?${params.toString()}`);
  if (!res.ok) { const t = await res.text(); throw new Error(`SAM entity search ${res.status}: ${t.slice(0, 300)}`); }
  return res.json();
}

async function samEntitySearchByNaics({ naicsCode, state, limit }) {
  const cap = Math.min(limit || ENTITY_PAGE_SIZE * ENTITY_MAX_PAGES, ENTITY_PAGE_SIZE * ENTITY_MAX_PAGES);
  let totalRecords = null, entities = [];
  for (let page = 0; page < ENTITY_MAX_PAGES && entities.length < cap; page++) {
    const payload = await fetchEntityPage({ naicsCode, state, page, size: ENTITY_PAGE_SIZE });
    if (totalRecords === null) totalRecords = payload.totalRecords ?? payload.totalrecords ?? payload.totalElements ?? null;
    const batch = (payload.entityData || []).map(mapEntity).filter(e => e.businessName);
    entities = entities.concat(batch);
    if (batch.length < ENTITY_PAGE_SIZE) break; // last page
    if (totalRecords !== null && entities.length >= totalRecords) break;
  }
  entities = entities.slice(0, cap);
  return { entities, totalRecords: totalRecords === null ? entities.length : totalRecords };
}

module.exports = {
  SUPABASE_URL, SUPABASE_KEY, SAM_KEY, SESSION_SECRET, OPS_PASSWORD, TEST_OPS_PASSWORD, TEST_OPS_EXPIRES_AT, MAILING_ADDRESS,
  TEST_RECIPIENT, RESEND_FROM, RESEND_KEY, OPENAI_KEY, SITE_ORIGIN,
  json, sbHeaders, sameOrigin, hmacHex, sha256Hex, issueOpsSession, verifyOpsSessionDetails, verifyOpsSession, opsGuard,
  samEntitySearchByNaics,
};
