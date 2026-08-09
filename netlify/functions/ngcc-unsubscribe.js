// NGCC — recipient-facing unsubscribe link (clicked from outside the site,
// so intentionally no same-origin check). Token is a stateless HMAC of the
// email address using the same AUTH_TOKEN_SECRET reused across this
// feature — no separate tokens table needed.
//
// Writes to the SHARED unsubscribe_suppressions table (created for
// BusinessContracts), not a new NGCC-only table, so a suppression here is
// honored by BusinessContracts' outreach too, and vice versa — one
// unsubscribe list across all Apropos outbound email. This is intentionally
// separate from this repo's existing contractor_contacts/email_batch
// campaign tables (send-contractor-outreach.js), which have their own
// unsubscribe handling (reply with "unsubscribe" in the subject line) — not
// touched here.
'use strict';
const { sbHeaders, SUPABASE_URL, sha256Hex } = require('./lib/ngcc-ops');

function page(title, body, tone) {
  const accent = tone === 'green' ? '#3EE391' : tone === 'red' ? '#FF6969' : '#D5AE55';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | NGCC</title></head><body style="margin:0;background:#0F2A6A;color:#fff;font-family:Arial,Helvetica,sans-serif"><main style="min-height:100vh;display:grid;place-items:center;padding:24px"><section style="width:min(560px,100%);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:38px 34px;border-top:3px solid ${accent}"><div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:12px">National Government Contract Center</div><h1 style="margin:0 0 14px;font-size:28px;font-weight:400">${title}</h1>${body}</section></main></body></html>`;
}
function html(statusCode, title, body, tone) {
  return { statusCode, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: page(title, body, tone) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return html(405, 'Unsupported request', '<p>This link accepts browser requests only.</p>');
  const qs = event.queryStringParameters || {};
  const email = (qs.email || '').trim().toLowerCase();
  const token = (qs.t || '').trim();
  if (!email || !token) return html(400, 'Invalid unsubscribe link', '<p>This unsubscribe link is incomplete.</p>');

  try {
    const expected = sha256Hex(`unsub.${email}.${process.env.AUTH_TOKEN_SECRET}`);
    if (expected !== token) return html(400, 'Invalid unsubscribe link', '<p>This unsubscribe link could not be verified.</p>');

    await fetch(`${SUPABASE_URL}/rest/v1/unsubscribe_suppressions`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([{ email_hash: sha256Hex(email), email_address: email, reason: 'Recipient selected unsubscribe from NGCC opportunity introduction.' }]),
    });

    return html(200, 'You have been unsubscribed', '<p style="color:rgba(255,255,255,.65);line-height:1.7">Your address has been added to the Apropos outreach suppression registry and will not receive future promotional opportunity introductions from NGCC or other Apropos Group products.</p>', 'green');
  } catch (error) {
    console.error('[ngcc-unsubscribe]', error.message);
    return html(500, 'Unsubscribe could not be completed', '<p>Please contact us directly and reference this email to be removed manually.</p>', 'red');
  }
};
