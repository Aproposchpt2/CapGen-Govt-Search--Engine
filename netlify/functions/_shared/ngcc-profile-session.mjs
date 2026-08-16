// NGCC — business capability profile session helper, ported from NAT-CORP's
// netlify/functions/_shared/natcorp-profile-session.mjs (2026-08-16,
// Registered Federal Contractors Portal merge).
//
// Deliberately kept on the SAME cookie name and the SAME backing table
// (natcorp_business_intakes) as NAT-CORP, not a parallel ngcc_* table --
// that's the actual point of the merge: one shared intake, one shared
// aoie_business_profiles record, usable by both products' contract matching.
// A profile built through NGCC's welcome flow is a NAT-CORP-recognizable
// profile too, and vice versa, by construction, not by a sync job. NGCC
// intakes are distinguished from NAT-CORP's only by intake_payload.source
// ('ngcc-website-capability-intake-v1' vs 'natcorp-website-capability-intake-v1').
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { db, nowIso } from './ngcc-profile-db.mjs';

export const PROFILE_COOKIE = 'natcorp_profile_session';
export const PROFILE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const safe = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
export const asArray = (value) => Array.isArray(value) ? value : [];

export function validEmail(value) {
  const email = safe(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function rejectHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.invalid') || host.endsWith('.test')) return true;
  if (isIP(host)) return true;
  return !host.includes('.');
}

export function normalizeWebsite(value) {
  let raw = safe(value, 700);
  if (!raw) throw new Error('Business website URL is required.');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Enter a valid business website URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Business website must use http:// or https://.');
  if (url.username || url.password) throw new Error('Business website URL cannot include credentials.');
  if (rejectHostname(url.hostname)) throw new Error('Business website must use a public internet domain.');
  url.hash = '';
  const canonicalDomain = url.hostname.toLowerCase().replace(/^www\./, '');
  return { website: url.href, canonical_domain: canonicalDomain };
}

export function sameBusinessDomain(candidateUrl, canonicalDomain) {
  if (!candidateUrl || !canonicalDomain) return false;
  try {
    const host = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === canonicalDomain || host.endsWith(`.${canonicalDomain}`);
  } catch {
    return false;
  }
}

export function sessionTokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function issueProfileSession() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    token_hash: sessionTokenHash(token),
    expires_at: new Date(Date.now() + PROFILE_SESSION_TTL_SECONDS * 1000).toISOString(),
  };
}

export function profileSessionCookie(token) {
  return `${PROFILE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${PROFILE_SESSION_TTL_SECONDS}`;
}

export function clearProfileSessionCookie() {
  return `${PROFILE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function cookieValue(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return part.slice(index + 1).trim(); }
  }
  return '';
}

export async function loadProfileSession(req) {
  const token = cookieValue(req, PROFILE_COOKIE);
  if (!token) return null;
  const hash = sessionTokenHash(token);
  const rows = await db(
    'natcorp_business_intakes',
    'GET',
    `?intake_kind=eq.business_profile&session_token_hash=eq.${encodeURIComponent(hash)}&select=*&limit=1`,
  );
  const session = rows?.[0] || null;
  if (!session) return null;
  if (session.session_expires_at && new Date(session.session_expires_at).getTime() <= Date.now()) return null;
  return session;
}

export function publicProfileSession(session) {
  if (!session) return null;
  return {
    intake_id: session.intake_id,
    status: session.status,
    discovery_status: session.discovery_status,
    contact_name: session.contact_name || session.intake_payload?.contact_name || null,
    business_name: session.business_name || session.intake_payload?.business_name || null,
    business_email: session.business_email || session.contact_email || null,
    website: session.website || session.intake_payload?.website || null,
    visitor_email: session.visitor_email || session.intake_payload?.visitor_email || null,
    canonical_domain: session.canonical_domain || null,
    resident_state: session.resident_state || session.draft_profile?.resident_state || session.verified_profile?.resident_state || null,
    draft_profile: session.draft_profile || {},
    verified_profile: session.verified_profile || {},
    business_profile_id: session.business_profile_id || null,
    verified_at: session.verified_at || null,
    matching_scope: session.matching_scope || 'all_states',
    last_error: session.last_error || null,
    updated_at: session.updated_at || nowIso(),
  };
}
