// send-contractor-outreach.js
// Sends personalized NGCC pitch emails to newly registered federal contractors.
// Reads from contractor_contacts (Hunter-verified emails) joined with contractors.
// Logs each send to email_batch. Updates outreach_status to 'sent' on the contractor.
// Rate-limited to 2/sec to stay within Resend limits.
// Trigger: POST /.netlify/functions/send-contractor-outreach
// Requires: RESEND_API_KEY, RESEND_FROM_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional QS: ?limit=10&dry_run=1 (dry_run skips actual send, logs only)
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL || 'jeff@aproposgroupllc.com';
const FROM_NAME    = 'Jeff Mitchell — Apropos Group LLC';
const NGCC_URL     = 'https://ngcc.aproposgroupllc.com';

const NAICS_SHORT = {
  '541511':'Custom Software Development','541512':'IT Systems Design',
  '541513':'IT Facilities Management','541519':'Technology Services',
  '541330':'Engineering','541370':'Surveying & Mapping',
  '541611':'Management Consulting','541612':'HR Consulting',
  '541613':'Marketing Consulting','541614':'Logistics Consulting',
  '541618':'Business Consulting','541690':'Scientific Services',
  '561210':'Facilities Support','518210':'Data Processing',
  '238210':'Electrical Contracting','484110':'Freight & Logistics',
  '561320':'Staffing & Recruiting','561499':'Business Support'
};

const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

function naicsLabel(codes) {
  if (!Array.isArray(codes) || !codes.length) return 'government services';
  const labels = codes.slice(0, 3).map(c => NAICS_SHORT[c]).filter(Boolean);
  return labels.length ? labels.join(', ') : codes.slice(0, 2).join(', ');
}

function buildEmail(contact, contractor) {
  const first = contact.first_name || 'there';
  const biz   = contractor.legal_name || 'your company';
  const state  = contractor.address_state || '';
  const services = naicsLabel(contractor.naics_codes);
  const primary  = NAICS_SHORT[contractor.primary_naics] || contractor.primary_naics || 'government services';

  const subject = `${first}, your federal contracts are waiting — we found them`;

  const body = `Hi ${first},

Congratulations on your recent federal registration${state ? ` in ${state}` : ''}.

You've taken the first step. The next one — finding the right contracts to actually bid on — is where most new registrants get stuck. Hundreds of open opportunities, no clear path to the ones that match what you do.

That's exactly what we built.

The National Government Contract Center (NGCC) matches your registered NAICS codes to open federal and state contracts, scores each one for fit against your capability profile, and gives you a clear bid/no-bid recommendation with the reasoning — before you spend a day writing a proposal.

For a ${primary} firm like ${biz}, we're already surfacing contracts across your registered codes including ${services}. You'll see what's open, what you qualify for, and which ones are worth pursuing.

Start your dashboard here: ${NGCC_URL}

The first 30 days are free. No credit card required to get started.

If you have any questions, reply directly to this email — I'm the one sending it.

Best,
Jeff Mitchell
Founder, Apropos Group LLC
${NGCC_URL}

---
You're receiving this because ${biz} appears in official public records as a newly registered federal contractor. To unsubscribe, reply with "unsubscribe" in the subject line.`;

  return { subject, body };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  const qs = event.queryStringParameters || {};
  const limit   = Math.min(parseInt(qs.limit || '20', 10), 100);
  const dry_run = qs.dry_run === '1';

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!RESEND_KEY && !dry_run) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not set' }) };
  }

  // Load queued contacts with their contractor record
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/contractor_contacts?select=id,email,first_name,last_name,confidence_score,contractor_id,contractors(id,legal_name,naics_codes,primary_naics,address_state,outreach_status)&contractors.outreach_status=in.(queued,pending)&confidence_score=gte.70&order=confidence_score.desc&limit=${limit}`,
    { headers: sbH() }
  );
  const contacts = await res.json();

  if (!Array.isArray(contacts) || !contacts.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sent: 0, message: 'No contacts available to send.' }) };
  }

  // Deduplicate: one email per contractor (take highest confidence)
  const seen = new Set();
  const queue = contacts.filter(c => {
    const cid = c.contractor_id;
    if (seen.has(cid)) return false;
    seen.add(cid);
    return c.contractors && ['queued','pending'].includes(c.contractors.outreach_status);
  });

  let sent = 0, failed = 0, skipped = 0;
  const log = [];

  for (const contact of queue) {
    const contractor = contact.contractors;
    if (!contractor || !contact.email) { skipped++; continue; }

    const { subject, body } = buildEmail(contact, contractor);

    try {
      let resendId = null;

      if (!dry_run) {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: [`${contact.first_name || ''} ${contact.last_name || ''} <${contact.email}>`],
            subject,
            text: body,
            reply_to: FROM_EMAIL,
            tags: [{ name: 'campaign', value: 'ngcc-launch-outreach' }]
          })
        });
        const emailData = await emailRes.json();
        if (!emailRes.ok) throw new Error(emailData.message || `Resend error ${emailRes.status}`);
        resendId = emailData.id;
      }

      // Log to email_batch
      await fetch(`${SUPABASE_URL}/rest/v1/email_batch`, {
        method: 'POST',
        headers: { ...sbH(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          contractor_id: contact.contractor_id,
          contact_id: contact.id,
          to_email: contact.email,
          to_name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          subject,
          body,
          status: dry_run ? 'dry_run' : 'sent',
          resend_message_id: resendId,
          sent_at: dry_run ? null : new Date().toISOString()
        })
      });

      // Mark contractor as sent (or dry_run)
      if (!dry_run) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/contractors?id=eq.${encodeURIComponent(contact.contractor_id)}`,
          { method: 'PATCH', headers: { ...sbH(), Prefer: 'return=minimal' }, body: JSON.stringify({ outreach_status: 'sent' }) }
        );
      }

      sent++;
      log.push({ email: contact.email, business: contractor.legal_name, status: dry_run ? 'dry_run' : 'sent' });

    } catch (err) {
      failed++;
      log.push({ email: contact.email, business: contractor.legal_name, status: 'failed', error: err.message });
      console.error('Send failed:', contact.email, err.message);
    }

    // Rate limit: 2 emails/sec
    if (!dry_run) await sleep(500);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, sent, failed, skipped, dry_run, total_processed: queue.length, log })
  };
};
