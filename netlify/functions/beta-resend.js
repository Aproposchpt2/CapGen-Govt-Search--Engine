'use strict';
// POST { email } → finds active beta_testers row, resends welcome email with dashboard link.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL || 'CapGen <jmitchell@ai4websitedesign.com>';
const SITE_URL     = 'https://capgen.aproposgroupllc.com';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbH() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid email required.' }) };
  }

  // Look up beta tester
  const res  = await fetch(
    `${SUPABASE_URL}/rest/v1/beta_testers?email=eq.${encodeURIComponent(email)}&status=eq.active&limit=1`,
    { headers: sbH() }
  );
  const rows = await res.json();

  // Always return success — don't reveal whether email exists (security)
  if (!Array.isArray(rows) || !rows[0]) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  }

  const tester      = rows[0];
  const dashUrl     = `${SITE_URL}/demo/snapshot?t=${encodeURIComponent(tester.access_token)}`;
  const firstName   = (tester.full_name || '').split(' ')[0] || 'there';

  // Send access link email
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: 'Your CapGen Beta Dashboard Link',
        html: `
<div style="font-family:Arial,sans-serif;background:#0A1A3A;padding:40px 20px;min-height:100vh;">
  <div style="max-width:480px;margin:0 auto;background:#0f2244;border:1px solid rgba(91,175,255,.25);border-radius:18px;padding:36px 32px;">
    <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#5BD3FF;font-weight:700;">CapGen Beta</p>
    <h2 style="margin:0 0 16px;font-size:22px;color:#f0f6ff;">Here's your dashboard link, ${firstName}.</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#8facd0;line-height:1.7;">
      Your beta access is still active. Click below to open your personal dashboard.
    </p>
    <div style="background:#07111f;border:2px solid #6EE7A8;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
      <div style="font-size:11px;color:#5a7899;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">Your Personal Dashboard Link</div>
      <a href="${dashUrl}" style="color:#6EE7A8;font-size:13px;word-break:break-all;font-weight:700;text-decoration:none;">${dashUrl}</a>
    </div>
    <a href="${dashUrl}" style="display:block;background:#6EE7A8;color:#0A1A3A;font-weight:700;font-size:15px;padding:16px;border-radius:10px;text-align:center;text-decoration:none;">Open My Dashboard →</a>
    <p style="margin:20px 0 0;font-size:11px;color:#2a3f52;font-style:italic;text-align:center;">Need help? Return anytime to capgen.aproposgroupllc.com/beta</p>
  </div>
</div>`,
      }),
    });
  } catch(e) { console.error('[beta-resend] email failed:', e.message); }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
