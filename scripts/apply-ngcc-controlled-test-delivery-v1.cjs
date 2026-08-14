'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'netlify/functions/ngcc-ops-outreach.js');
let source = fs.readFileSync(file, 'utf8');

source = source.replace(
  "const PRODUCTION_SEND = true;",
  "const PRODUCTION_SEND = true && String(process.env.NGCC_OUTREACH_DELIVERY_MODE || 'test').trim().toLowerCase() === 'production';"
);

source = source.replace(
  "  if (!PRODUCTION_SEND) throw new Error('Production outreach is disabled.');\n  if (!RESEND_KEY) throw new Error('RESEND_API_KEY is not configured.');",
  "  if (!RESEND_KEY) throw new Error('RESEND_API_KEY is not configured.');\n  if (!PRODUCTION_SEND && !TEST_RECIPIENT) throw new Error('Controlled test delivery recipient is not configured.');"
);

source = source.replace(
  "    const clientResponse = await fetch('https://api.resend.com/emails', {",
  "    const deliveryRecipient = PRODUCTION_SEND ? outreach.contact_email : TEST_RECIPIENT;\n    const clientResponse = await fetch('https://api.resend.com/emails', {"
);

source = source.replace(
  "        to: [outreach.contact_email],",
  "        to: [deliveryRecipient],"
);

source = source.replace(
  "          { name: 'mode', value: 'production' },",
  "          { name: 'mode', value: PRODUCTION_SEND ? 'production' : 'controlled_test' },"
);

source = source.replace(
  "        production_send: true,\n        delivered_recipient: outreach.contact_email,",
  "        production_send: PRODUCTION_SEND,\n        delivery_mode: PRODUCTION_SEND ? 'production' : 'controlled_test',\n        intended_recipient: outreach.contact_email,\n        delivered_recipient: deliveryRecipient,"
);

source = source.replaceAll("production_mode: true", "production_mode: PRODUCTION_SEND");

if (!source.includes("NGCC_OUTREACH_DELIVERY_MODE || 'test'")) {
  throw new Error('Controlled test-delivery patch did not apply.');
}
if (!source.includes('to: [deliveryRecipient]')) {
  throw new Error('Controlled recipient routing patch did not apply.');
}

fs.writeFileSync(file, source);
console.log(`Applied NGCC controlled delivery mode: ${process.env.NGCC_OUTREACH_DELIVERY_MODE === 'production' ? 'production' : 'test-default'}.`);
