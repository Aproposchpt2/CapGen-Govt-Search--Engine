'use strict';

const fs = require('fs');
const path = require('path');

const outreachFile = path.join(process.cwd(), 'netlify/functions/ngcc-ops-outreach.js');
let outreach = fs.readFileSync(outreachFile, 'utf8');

const oldClaimUrl = `function claimUrl(contract, candidate, reference) {
  const params = new URLSearchParams({
    notice_id: contract.noticeId || '',
    sam_url: contract.samUrl || '',
    title: contract.title || '',
    agency: contract.agency || '',
    solicitation: contract.solicitationNumber || '',
    ref: reference || claimReference(contract, candidate),
  });
  return \`https://marketplace.aproposgroupllc.com/claim-federal-opportunity?\${params.toString()}\`;
}`;
const newClaimUrl = `const MARKETPLACE_CLAIM_FRONT_DOOR = 'https://marketplace.aproposgroupllc.com/';

function claimUrl() {
  return MARKETPLACE_CLAIM_FRONT_DOOR;
}`;

if (outreach.includes(oldClaimUrl)) outreach = outreach.replace(oldClaimUrl, newClaimUrl);
else if (!outreach.includes('MARKETPLACE_CLAIM_FRONT_DOOR')) throw new Error('NGCC Marketplace claim URL patch anchor not found.');

outreach = outreach.replace(
  '>Claim This Complimentary Opportunity</a>',
  '>VISIT APROPOS MARKETPLACE</a>'
);

const oldInstructions = `Response deadline: \${deadline}
Opportunity Reference: \${reference}

Claim this complimentary opportunity to open your secure APROPOS Opportunity Workspace:
\${claimLink}`;
const newInstructions = `Response deadline: \${deadline}

Claim Your Complimentary Contract Opportunity

APROPOS has identified this contract opportunity for your business.

To claim your complimentary opportunity:

1. Visit:
   marketplace.aproposgroupllc.com

2. Select:
   CLAIM YOUR COMPLIMENTARY CONTRACT OPPORTUNITY

3. Enter your Opportunity Reference:
   \${reference}`;

if (outreach.includes(oldInstructions)) outreach = outreach.replace(oldInstructions, newInstructions);
else if (!outreach.includes('CLAIM YOUR COMPLIMENTARY CONTRACT OPPORTUNITY')) throw new Error('NGCC Marketplace claim instruction patch anchor not found.');

fs.writeFileSync(outreachFile, outreach);

const claimFile = path.join(process.cwd(), 'netlify/functions/ngcc-federal-claim.js');
let claim = fs.readFileSync(claimFile, 'utf8');

const oldNotice = `  const noticeId = safe(body.notice_id || body.source_reference);`;
const newNotice = `  // REFERENCE_ONLY_FEDERAL_CLAIM: the common Marketplace claim page does not need
  // to expose SAM notice metadata. Resolve the original sent outreach from the
  // recipient identity + NG Opportunity Reference when notice_id is absent.
  let noticeId = safe(body.notice_id || body.source_reference);`;
if (claim.includes(oldNotice)) claim = claim.replace(oldNotice, newNotice);
else if (!claim.includes('REFERENCE_ONLY_FEDERAL_CLAIM')) throw new Error('NGCC federal claim notice patch anchor not found.');

claim = claim.replace(
  `  if (!noticeId || !name || !businessName || !email || !reference) {\n    return json(400, { ok: false, error: 'Name, business name, business email, Opportunity Reference, and SAM.gov notice are required.' });\n  }`,
  `  if (!name || !businessName || !email || !reference) {\n    return json(400, { ok: false, error: 'Name, business name, business email, and Opportunity Reference are required.' });\n  }`
);

const oldLoad = `    const outreach = await loadOutreachForClaim(noticeId, email);\n    if (!outreach) return json(404, { ok: false, error: 'This complimentary federal opportunity could not be verified for that business email.' });`;
const newLoad = `    let outreach = null;\n    if (noticeId) {\n      outreach = await loadOutreachForClaim(noticeId, email);\n    } else {\n      const rows = await sb(\n        'ngcc_outreach_events',\n        'GET',\n        \`?contact_email=eq.\${encodeURIComponent(email)}&status=eq.sent&select=*&order=created_at.desc&limit=50\`\n      );\n      outreach = (rows || []).find(row => {\n        const rowNoticeId = safe(row.notice_id);\n        return rowNoticeId\n          && claimReference(rowNoticeId, email) === reference\n          && normalize(businessName) === normalize(row.business_name);\n      }) || null;\n      noticeId = safe(outreach?.notice_id);\n    }\n    if (!outreach || !noticeId) return json(404, { ok: false, error: 'This complimentary federal opportunity could not be verified for that business email and Opportunity Reference.' });`;
if (claim.includes(oldLoad)) claim = claim.replace(oldLoad, newLoad);
else if (!claim.includes('contact_email=eq.${encodeURIComponent(email)}&status=eq.sent')) throw new Error('NGCC federal claim outreach resolver patch anchor not found.');

fs.writeFileSync(claimFile, claim);
console.log('Applied NGCC Marketplace front-door email and reference-only federal claim routing.');
