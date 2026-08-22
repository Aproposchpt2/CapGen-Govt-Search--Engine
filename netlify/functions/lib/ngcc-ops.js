// Registered Federal Contractors Portal — shared helpers for the internal
// operator outreach tools. Existing function/module identifiers are preserved
// for runtime compatibility and are not public product branding.
//
// This is a DIFFERENT feature from send-contractor-outreach.js /
// import-active-contractors.js / enricher-hunter.js, which already exist in
// this repo and run a general portal sign-up campaign against a bulk SAM.gov
// import (contractors / contractor_contacts / email_batch tables).
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
//   MAILING_ADDRESS    — authoritative APROPOS commercial mailing address.
//                        Used in the outreach email footer for CAN-SPAM compliance.
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
const MAILING_ADDRESS = process.env.MAILING_ADDRESS || 'APROPOS GROUP LLC, 5892 Losee Rd., Ste 132, North Las Vegas, NV 89081';
const TEST_RECIPIENT = process.env.RESEND_TO_EMAIL || '';
const RESEND_FROM = process.env.NGCC_OPPORTUNITY_FROM_EMAIL || 'Registered Federal Contractors Portal <opportunities@aproposcontracts.com>';
const RESEND_KEY = process.env.RESEND_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SITE_ORIGIN = 'https://federalcontractorportal.aproposgroupllc.com';
const SESSION_TTL_SECONDS = 12 * 3600;

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

function verifyOpsSessionDetails(event) {
  const headers = event.headers || {};
  const header = headers.authorization || headers.Authorization || '';
  const cookieHeader = headers.cookie || headers.Cookie || '';
  const cookieToken = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith('rfcp_ops='))?.slice('rfcp_ops='.length) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : decodeURIComponent(cookieToken);
  const parts = token.split('.');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [expStr, roleOrSig, versionedSig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

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

const ENTITY_PAGE_SIZE = 10;
const ENTITY_MAX_PAGES = 2;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function mapEntity(e) {
  const reg = e.entityRegistration || {};
  const core = e.coreData || {};
  const assertions = e.assertions || {};
  const goods = assertions.goodsAndServices || {};
  const businessTypes = core.businessTypes || {};
  const addr = core.physicalAddress || core.mailingAddress || {};

  const registeredNaics = list(goods.naicsList).map(item => ({
    naics_code: String(item.naicsCode || '').trim(),
    description: String(item.naicsDescription || item.naicsName || '').trim() || null,
    is_primary: String(item.naicsCode || '').trim() === String(goods.primaryNaics || '').trim() || item.isPrimary === true || String(item.isPrimary || '').toUpperCase() === 'Y',
    sba_small_business: item.sbaSmallBusiness ?? item.isSmallBusiness ?? null,
  })).filter(item => item.naics_code);

  const registeredPscs = list(goods.pscList).map(item => ({
    psc_code: String(item.pscCode || '').trim(),
    description: String(item.pscDescription || '').trim() || null,
  })).filter(item => item.psc_code);

  const classifications = [
    ...list(businessTypes.businessTypeList).map(item => item.businessTypeDesc),
    ...list(businessTypes.sbaBusinessTypeList).map(item => item.sbaBusinessTypeDesc),
  ].map(value => String(value || '').trim()).filter(Boolean);

  return {
    ueiSAM: reg.ueiSAM || '',
    businessName: reg.legalBusinessName || reg.entityName || '',
    cageCode: reg.cageCode || '',
    city: addr.city || '',
    state: addr.stateOrProvinceCode || '',
    registration_status: reg.registrationStatus || '',
    sam_last_update_date: reg.lastUpdateDate || null,
    primary_naics: goods.primaryNaics || null,
    registered_naics: registeredNaics,
    registered_pscs: registeredPscs,
    business_classifications: [...new Set(classifications)],
  };
}

async function fetchEntityPage({ naicsCode, state, page, size }) {
  const params = new URLSearchParams({
    api_key: SAM_KEY,
    naicsCode,
    registrationStatus: 'A',
    includeSections: 'entityRegistration,coreData,assertions',
    page: String(page),
    size: String(size),
  });
  if (state) params.set('physicalAddressProvinceOrStateCode', state);
  const res = await fetch(`https://api.sam.gov/entity-information/v3/entities?${params.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SAM entity search ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function samEntitySearchByNaics({ naicsCode, state, limit }) {
  const cap = Math.min(limit || ENTITY_PAGE_SIZE * ENTITY_MAX_PAGES, ENTITY_PAGE_SIZE * ENTITY_MAX_PAGES);
  let totalRecords = null;
  let entities = [];
  for (let page = 0; page < ENTITY_MAX_PAGES && entities.length < cap; page++) {
    const payload = await fetchEntityPage({ naicsCode, state, page, size: ENTITY_PAGE_SIZE });
    if (totalRecords === null) totalRecords = payload.totalRecords ?? payload.totalrecords ?? payload.totalElements ?? null;
    const batch = (payload.entityData || []).map(mapEntity).filter(e => e.businessName);
    entities = entities.concat(batch);
    if (batch.length < ENTITY_PAGE_SIZE) break;
    if (totalRecords !== null && entities.length >= totalRecords) break;
  }
  entities = entities.slice(0, cap);
  return { entities, totalRecords: totalRecords === null ? entities.length : totalRecords };
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_KEY,
  SAM_KEY,
  SESSION_SECRET,
  OPS_PASSWORD,
  TEST_OPS_PASSWORD,
  TEST_OPS_EXPIRES_AT,
  MAILING_ADDRESS,
  TEST_RECIPIENT,
  RESEND_FROM,
  RESEND_KEY,
  OPENAI_KEY,
  SITE_ORIGIN,
  json,
  sbHeaders,
  sameOrigin,
  hmacHex,
  sha256Hex,
  issueOpsSession,
  verifyOpsSessionDetails,
  verifyOpsSession,
  opsGuard,
  samEntitySearchByNaics,
};
