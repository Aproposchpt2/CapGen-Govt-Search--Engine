'use strict';
// stripe-capgen-webhook.js
// Fires on checkout.session.completed → creates Supabase user + sends welcome email.
// Set STRIPE_CAPGEN_WEBHOOK_SECRET in Netlify from Stripe webhook dashboard.

const crypto = require('crypto');

const PIPELINE_URL  = 'https://capgen.aproposgroupllc.com/pipeline';
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const FROM_EMAIL    = process.env.RESEND_FROM_EMAIL || 'alerts@aproposgroupllc.com';
const WEBHOOK_SEC   = process.env.STRIPE_CAPGEN_WEBHOOK_SECRET || '';

function verifyStripeSignature(rawBody, sigHeader, secret) {
  try {
    const parts = sigHeader.split(',').reduce((acc, p) => {
      const [k, v] = p.split('='); acc[k] = v; return acc;
    }, {});
    const signed   = `${parts.t}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    const received = Buffer.from(parts.v1 || '', 'hex');
    const exp      = Buffer.from(expected, 'hex');
    return received.length === exp.length && crypto.timingSafeEqual(exp, received);
  } catch { return false; }
}

async function createSupabaseUser(email, metadata) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: metadata }),
  });
  const data = await res.json();
  return data;
}

async function sendWelcomeEmail(email, firstName, businessName, stripeCustomerId) {
  const html = `
  <div style="font-family:Arial,sans-serif;background:#0A1A3A;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;background:#0f2244;border:1px solid rgba(91,175,255,.25);border-radius:18px;padding:36px 32px;">
      <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#5BD3FF;font-weight:700;">CapGen Pro · AI4 Businesses</p>
      <h2 style="margin:0 0 16px;font-size:22px;color:#f0f6ff;">You're in, ${firstName}. Welcome to CapGen Pro.</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#8facd0;line-height:1.7;">Your personalized federal contract pipeline is ready. Sign in below to access your dashboard now.</p>
      <div style="background:#132954;border:1px solid rgba(91,175,255,.15);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <p style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#5a7899;font-weight:700;">How to Access Your Dashboard</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:6px 0;font-size:14px;color:#8facd0;"><span style="color:#5BD3FF;font-weight:700;">Step 1</span> &nbsp; Click the button below to open your pipeline</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#8facd0;"><span style="color:#5BD3FF;font-weight:700;">Step 2</span> &nbsp; Enter your email address and click Send Code</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#8facd0;"><span style="color:#5BD3FF;font-weight:700;">Step 3</span> &nbsp; Check your inbox for your 6-digit access code</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#8facd0;"><span style="color:#5BD3FF;font-weight:700;">Step 4</span> &nbsp; Enter the code — your dashboard opens immediately</td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:12px;color:#3a5470;">No password required. Your email is your key.</p>
      </div>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="background:#5BD3FF;border-radius:10px;padding:14px 28px;text-align:center;">
          <a href="${PIPELINE_URL}" style="color:#0A1A3A;font-weight:700;font-size:15px;text-decoration:none;">Open My Pipeline →</a>
        </td></tr>
      </table>
      <p style="margin:0;font-size:12px;color:#3a5470;">Questions? Reply to this email — we respond same business day.<br/>Apropos Group LLC · AI4 Businesses</p>
    </div>
  </div>`;

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: `Welcome to CapGen Pro — ${businessName || 'Your Pipeline is Being Built'}`,
      html,
    }),
  });
}

async function logOnboarding(email, firstName, businessName, stripeCustomerId, stripeSessionId) {
  return fetch(`${SUPABASE_URL}/rest/v1/client_onboarding`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      email, first_name: firstName, business_name: businessName,
      pipeline_url: PIPELINE_URL, welcome_sent_at: new Date().toISOString(),
      metadata: { stripe_customer_id: stripeCustomerId, stripe_session_id: stripeSessionId, source: 'stripe_checkout' },
    }),
  }).catch(e => console.warn('Log error:', e.message));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  const rawBody  = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body || '');
  const sigHeader = event.headers['stripe-signature'] || '';

  if (WEBHOOK_SEC && !verifyStripeSignature(rawBody, sigHeader, WEBHOOK_SEC)) {
    console.error('stripe-capgen-webhook: invalid signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session       = stripeEvent.data.object;
  const email         = session.customer_details?.email || session.customer_email || '';
  const firstName     = session.customer_details?.name?.split(' ')[0] || 'there';
  const businessName  = session.metadata?.business_name || session.customer_details?.name || '';
  const customerId    = session.customer || '';
  const sessionId     = session.id || '';

  if (!email) {
    console.error('stripe-capgen-webhook: no email in session');
    return { statusCode: 200, body: 'No email — skipped' };
  }

  console.log(`CapGen onboard: ${businessName} <${email}>`);

  // 1. Create Supabase user
  try { await createSupabaseUser(email, { first_name: firstName, business_name: businessName }); }
  catch (e) { console.warn('Supabase user note:', e.message); }

  // 2. Send welcome email
  try { await sendWelcomeEmail(email, firstName, businessName, customerId); }
  catch (e) { console.error('Welcome email error:', e.message); }

  // 3. Log onboarding
  await logOnboarding(email, firstName, businessName, customerId, sessionId);

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
