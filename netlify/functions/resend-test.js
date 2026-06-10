'use strict';
exports.handler = async function(event) {
  const KEY = process.env.RESEND_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not found in runtime' }) };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'CapGen Reports <reports@capgen.aproposgroupllc.com>',
      to: ['jmitchell1126@gmail.com'],
      subject: 'CapGen Sender Verification — reports@capgen.aproposgroupllc.com',
      html: '<p>Sender verification confirmed. <strong>reports@capgen.aproposgroupllc.com</strong> is live.</p>',
    }),
  });
  const body = await res.text();
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ send_status: res.status, send_response: JSON.parse(body) }) };
};