'use strict';

const assert = require('node:assert/strict');
const {
  reconcileClaims,
  reconcileResponse,
  closeoutMission,
} = require('../netlify/functions/lib/ngcc-response-closeout');

const rows = [
  { id: '1', business_name: 'Alpha LLC', contact_name: 'A', contact_email: 'A@EXAMPLE.COM', source_reference: 'NOTICE-1', redirect_url: 'https://sam.gov/opp/NOTICE-1/view', source: 'ngcc_outreach_claim', created_at: '2026-08-11T18:00:00Z' },
  { id: '2', business_name: 'Alpha LLC', contact_name: 'A', contact_email: 'a@example.com', source_reference: 'NOTICE-1', redirect_url: 'https://sam.gov/opp/NOTICE-1/view', source: 'ngcc_outreach_claim', created_at: '2026-08-11T18:01:00Z' },
  { id: '3', business_name: 'Other LLC', contact_name: 'B', contact_email: 'b@example.com', source_reference: 'NOTICE-2', redirect_url: 'https://sam.gov/opp/NOTICE-2/view', source: 'ngcc_outreach_claim', created_at: '2026-08-11T18:02:00Z' },
];

const claims = reconcileClaims(rows, 'NOTICE-1');
assert.equal(claims.length, 1, 'claims should be filtered to the mission notice and deduplicated by business/email/notice');
assert.equal(claims[0].contact_email, 'a@example.com');

const reconciliation = reconcileResponse({ noticeId: 'NOTICE-1', samUrl: 'https://sam.gov/opp/NOTICE-1/view', rows, sourceStatus: 'AVAILABLE' });
assert.equal(reconciliation.status, 'RESPONSE_RECEIVED');
assert.equal(reconciliation.response_count, 1);
assert.equal(reconciliation.handoff_options.official_opportunity.authoritative, true);
assert.match(reconciliation.handoff_options.analyze_fit.url, /analyze-fit\.html\?id=NOTICE-1/);
assert.match(reconciliation.handoff_options.contract_assistance.url, /cdc\.aproposgroupllc\.com\/contract-assistance\.html/);

const closeout = closeoutMission({ reconciliation, decision: 'HANDOFF_BOTH', operatorNote: 'Business requested assistance.' });
assert.equal(closeout.mission_outcome, 'CONTRACTOR_ENGAGED');
assert.equal(closeout.selected_handoffs.length, 2);

const none = reconcileResponse({ noticeId: 'NOTICE-1', rows: [], sourceStatus: 'AVAILABLE' });
assert.equal(none.status, 'AWAITING_RESPONSE');
assert.throws(() => closeoutMission({ reconciliation: none, decision: 'HANDOFF_ANALYZE_FIT' }), /response\/claim is required/);

const noResponseClose = closeoutMission({ reconciliation: none, decision: 'NO_RESPONSE_CLOSE' });
assert.equal(noResponseClose.mission_outcome, 'NO_RESPONSE');

console.log('NGCC response/closeout tests passed.');
