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
  '>View Contract Opportunity</a>'
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

const legacyIntro = `Opportunity Builds Business. Business Builds Community.

Apropos Group LLC is committed to supporting economic growth through a proactive approach to government procurement. We saw a gap: businesses are often forced to navigate fragmented procurement systems, monitor multiple agencies, and continuously search for relevant opportunities.

We saw an opportunity to make a difference by reducing that burden and delivering timely, relevant search intelligence to businesses whose capabilities align with government contracts.

Our system identified the government contract opportunity below because it appears relevant to your business.

Based on your SAM.gov registration, this federal opportunity appears relevant to \${candidate.business_name} (NAICS \${contract.naicsCode || 'Unavailable'}).`;
const conciseIntro = `Apropos Group LLC is a proactive procurement agency. Our automated system identifies qualified businesses whose services match contract requirements.

We discovered your company while sourcing businesses for this opportunity.

WHY YOUR BUSINESS WAS SELECTED
Your SAM.gov registration includes industry classifications aligned with this federal contract opportunity. Matching NAICS: \${contract.naicsCode || 'See opportunity details'}.`;
if (!outreach.includes(legacyIntro)) throw new Error('RFCP concise outreach introduction anchor not found.');
outreach = outreach.replace(legacyIntro, conciseIntro);

const legacyClosing = `When qualified businesses gain access to the right opportunities, they can grow revenue, strengthen capabilities, create jobs, and contribute to stronger communities.

Businesses grow. People prosper. Communities become stronger.

SAM.gov and the issuing agency remain authoritative. Restricted or controlled files may require direct access through SAM.gov or the issuing agency.`;
const conciseClosing = `If you are interested, click the link below to visit our website and download the complete contract package.

This service is complimentary—no purchase is required. You are also welcome to leave a comment or ask a question.

Good luck!`;
if (!outreach.includes(legacyClosing)) throw new Error('RFCP concise outreach closing anchor not found.');
outreach = outreach.replace(legacyClosing, conciseClosing);

const commandCenterFile = path.join(process.cwd(), 'ops-command-center-v3.html');
let commandCenter = fs.readFileSync(commandCenterFile, 'utf8');
commandCenter = commandCenter.replace(
  'The list defaults to highest Contract Qualification score first and all eligible businesses selected. Use Clear All to choose recipients one by one. No email is sent until Stage 07 draft review and explicit operator approval.',
  'Qualified businesses are listed for operator selection. No business is selected automatically. Select one or more businesses to activate Stage 07; no email is sent until draft review and explicit operator approval.'
);
commandCenter = commandCenter.replace(
  '.sort((a,b)=>qscore(b)-qscore(a)).map(c=>({...c,outreach_approved:true}))}',
  '.sort((a,b)=>qscore(b)-qscore(a)).map(c=>({...c,outreach_approved:false}))}'
);
commandCenter = commandCenter.replace(
  'original.outreach_approved=el.checked;saveEvidence()});',
  'original.outreach_approved=el.checked;saveEvidence();render()});'
);
if (!commandCenter.includes('outreach_approved:false')) throw new Error('RFCP zero-selection patch did not apply.');
if (!commandCenter.includes('original.outreach_approved=el.checked;saveEvidence();render()')) throw new Error('RFCP selection refresh patch did not apply.');
fs.writeFileSync(commandCenterFile, commandCenter);

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
