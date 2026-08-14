'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'netlify/functions/ngcc-ops-outreach.js');
let source = fs.readFileSync(file, 'utf8');

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

if (source.includes(oldClaimUrl)) source = source.replace(oldClaimUrl, newClaimUrl);
else if (!source.includes('MARKETPLACE_CLAIM_FRONT_DOOR')) throw new Error('NGCC Marketplace claim URL patch anchor not found.');

source = source.replace(
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

if (source.includes(oldInstructions)) source = source.replace(oldInstructions, newInstructions);
else if (!source.includes('CLAIM YOUR COMPLIMENTARY CONTRACT OPPORTUNITY')) throw new Error('NGCC Marketplace claim instruction patch anchor not found.');

fs.writeFileSync(file, source);
console.log('Applied NGCC Marketplace claim front-door email routing.');
