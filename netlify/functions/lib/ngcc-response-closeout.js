'use strict';

const RESPONSE_VERSION = 'ngcc-response-closeout-v1';
const CLOSEOUT_DECISIONS = new Set([
  'HANDOFF_ANALYZE_FIT',
  'HANDOFF_CONTRACT_ASSISTANCE',
  'HANDOFF_BOTH',
  'NO_RESPONSE_CLOSE',
  'DECLINED_CLOSE',
]);

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();

function normalizeClaim(row = {}) {
  return {
    claim_id: row.id || row.intake_id || row.lead_id || null,
    business_name: clean(row.business_name),
    contact_name: clean(row.contact_name),
    contact_email: lower(row.contact_email) || null,
    notice_id: clean(row.source_reference) || null,
    sam_url: clean(row.redirect_url) || null,
    source: clean(row.source) || null,
    claimed_at: row.created_at || null,
    response_status: 'CLAIMED',
  };
}

function reconcileClaims(rows = [], noticeId) {
  const target = clean(noticeId);
  const seen = new Set();
  const claims = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const claim = normalizeClaim(row);
    if (target && claim.notice_id && claim.notice_id !== target) continue;
    if (claim.source && claim.source !== 'ngcc_outreach_claim') continue;
    const key = `${claim.contact_email || ''}|${claim.notice_id || target}|${claim.business_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
  }
  claims.sort((a, b) => String(b.claimed_at || '').localeCompare(String(a.claimed_at || '')));
  return claims;
}

function buildHandoffOptions({ noticeId, samUrl } = {}) {
  const id = clean(noticeId);
  const officialSamUrl = clean(samUrl) || (id ? `https://sam.gov/opp/${encodeURIComponent(id)}/view` : null);
  return {
    analyze_fit: {
      service: 'Registered Federal Contractors Portal Analyze Fit',
      url: id ? `https://federalcontractorportal.aproposgroupllc.com/analyze-fit.html?id=${encodeURIComponent(id)}` : 'https://federalcontractorportal.aproposgroupllc.com/analyze-fit.html',
      requires_ngcc_session: true,
      note: 'Analyze Fit uses the registered contractor profile and the selected federal opportunity; the official SAM.gov record remains controlling.',
    },
    contract_assistance: {
      service: 'APROPOS Contract Development Center — Contract Assistance',
      url: 'https://cdc.aproposgroupllc.com/contract-assistance.html',
      requires_package_upload: true,
      note: 'Contract Assistance requires the business to supply the solicitation package and current amendments/addenda for review.',
    },
    official_opportunity: {
      service: 'SAM.gov',
      url: officialSamUrl,
      authoritative: true,
    },
  };
}

function reconcileResponse({ noticeId, samUrl, rows = [], sourceStatus = 'AVAILABLE', sourceError = null } = {}) {
  const claims = reconcileClaims(rows, noticeId);
  return {
    response_version: RESPONSE_VERSION,
    notice_id: clean(noticeId) || null,
    response_source: 'marketplace_lead_intake / ngcc_outreach_claim',
    response_source_status: sourceStatus,
    response_source_error: sourceError || null,
    claims,
    response_count: claims.length,
    status: claims.length ? 'RESPONSE_RECEIVED' : sourceStatus === 'AVAILABLE' ? 'AWAITING_RESPONSE' : 'RESPONSE_SOURCE_UNAVAILABLE',
    handoff_options: buildHandoffOptions({ noticeId, samUrl }),
  };
}

function closeoutMission({ reconciliation, decision, operatorNote = '' } = {}) {
  const selected = clean(decision).toUpperCase();
  if (!CLOSEOUT_DECISIONS.has(selected)) throw new Error('A valid operator closeout decision is required.');
  const claims = reconciliation?.claims || [];
  const requiresClaim = ['HANDOFF_ANALYZE_FIT', 'HANDOFF_CONTRACT_ASSISTANCE', 'HANDOFF_BOTH'].includes(selected);
  if (requiresClaim && !claims.length) throw new Error('A contractor response/claim is required before an assistance handoff can be closed out.');

  const handoffs = reconciliation?.handoff_options || buildHandoffOptions({ noticeId: reconciliation?.notice_id });
  const selectedHandoffs = [];
  if (selected === 'HANDOFF_ANALYZE_FIT' || selected === 'HANDOFF_BOTH') selectedHandoffs.push(handoffs.analyze_fit);
  if (selected === 'HANDOFF_CONTRACT_ASSISTANCE' || selected === 'HANDOFF_BOTH') selectedHandoffs.push(handoffs.contract_assistance);

  return {
    response_version: RESPONSE_VERSION,
    decision: selected,
    operator_note: clean(operatorNote) || null,
    closed_at: new Date().toISOString(),
    response_count: claims.length,
    responding_businesses: claims.map(claim => ({ business_name: claim.business_name, contact_email: claim.contact_email, claimed_at: claim.claimed_at })),
    selected_handoffs: selectedHandoffs,
    official_opportunity: handoffs.official_opportunity,
    mission_outcome: selected.startsWith('HANDOFF_') ? 'CONTRACTOR_ENGAGED' : selected === 'NO_RESPONSE_CLOSE' ? 'NO_RESPONSE' : 'CONTRACTOR_DECLINED',
  };
}

module.exports = {
  RESPONSE_VERSION,
  CLOSEOUT_DECISIONS,
  normalizeClaim,
  reconcileClaims,
  buildHandoffOptions,
  reconcileResponse,
  closeoutMission,
};
