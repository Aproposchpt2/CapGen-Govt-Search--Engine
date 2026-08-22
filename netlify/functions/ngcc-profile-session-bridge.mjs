import { randomUUID } from 'node:crypto';
import { db, json, nowIso, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  try {
    const profileSession = await loadProfileSession(req);
    if (!profileSession || profileSession.discovery_status !== 'verified') {
      return json(401, { ok: false, error: 'Verified business profile session required.' });
    }

    const email = String(profileSession.business_email || profileSession.contact_email || '').trim().toLowerCase();
    if (!email) return json(409, { ok: false, error: 'Verified profile does not contain a business email.' });

    const existing = await db(
      'client_sessions',
      'GET',
      `?email=eq.${encodeURIComponent(email)}&revoked=eq.false&expires_at=gt.${encodeURIComponent(nowIso())}&select=session_token,email,business_name,expires_at&order=created_at.desc&limit=1`,
    );
    if (existing?.[0]?.session_token) {
      return json(200, { ok: true, session_token: existing[0].session_token, email, business_name: existing[0].business_name || profileSession.business_name || '', expires_at: existing[0].expires_at, reused: true });
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await db('client_sessions', 'POST', '', [{
      session_token: token,
      email,
      uei: profileSession.verified_profile?.uei || null,
      business_name: profileSession.business_name || profileSession.verified_profile?.business_name || null,
      account_type: 'portal_profile',
      expires_at: expiresAt,
      revoked: false,
    }], 'return=representation');
    if (!rows?.[0]) throw new Error('Customer session could not be created.');

    return json(201, { ok: true, session_token: token, email, business_name: rows[0].business_name || '', expires_at: expiresAt, reused: false });
  } catch (error) {
    console.error('[rfcp-profile-session-bridge]', error);
    return json(500, { ok: false, error: 'Customer session bridge failed.' });
  }
}

export const config = {
  path: '/api/profile-session-bridge',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
