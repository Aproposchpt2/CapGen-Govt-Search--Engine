'use strict';

const assert = require('node:assert/strict');
const { qualifyCandidate, rankCandidates, qualificationSummary } = require('../netlify/functions/lib/ngcc-contractor-qualification');

const contractDna = {
  competition: { set_aside: 'Total Small Business Set-Aside', eligible_business_classification: 'Small Business' },
  hard_constraints: {
    mandatory_requirements: ['Provide three relevant past-performance references'],
    registration_requirements: [],
    geographic_restrictions: [],
    manufacturer_supplier_restrictions: ['Authorized distributor required'],
    other: [],
  },
};
const searchDna = {
  search_readiness: 'READY',
  hard_requirements: { required_business_classification: 'Small Business' },
  qualification: { compare_set_aside_eligibility: true },
};

const primary = {
  candidate_number: 1,
  ueiSAM: 'UEI-PRIMARY',
  cageCode: '1ABC2',
  businessName: 'Primary Path LLC',
  state: 'NV',
  matched_search_paths: [{ naics_code: '541512', source: 'sam_assigned', priority: 1 }],
};
const corroborated = {
  candidate_number: 2,
  ueiSAM: 'UEI-MULTI',
  cageCode: '2ABC3',
  businessName: 'Multi Path LLC',
  state: 'NV',
  matched_search_paths: [
    { naics_code: '541512', source: 'sam_assigned', priority: 1 },
    { naics_code: '541519', source: 'derived_related', priority: 3 },
  ],
};
const relatedOnly = {
  candidate_number: 3,
  ueiSAM: 'UEI-RELATED',
  cageCode: '3ABC4',
  businessName: 'Related Path LLC',
  state: 'CA',
  matched_search_paths: [{ naics_code: '541519', source: 'derived_related', priority: 3 }],
};

const one = qualifyCandidate({ candidate: primary, contractDna, businessSearchDna: searchDna });
assert.equal(one.qualification_status, 'REVIEW_REQUIRED', 'unknown set-aside/manufacturer/mandatory evidence must remain review-required');
assert.ok(one.qualification_score > 0, 'review-required candidates may still have a meaningful evidence score');
assert.ok(one.explanation.verification_required.some(item => item.code === 'SET_ASIDE_ELIGIBILITY'));
assert.ok(one.explanation.verification_required.some(item => item.code === 'MANUFACTURER_SUPPLIER_RESTRICTION'));
assert.equal(one.aoie_lineage.source_asset, 'netlify/functions/lib/aoie-federal.js');
assert.ok(one.aoie_lineage.engine_version, 'AOIE engine lineage must be retained');
assert.ok(one.aoie_lineage.ontology_version, 'AOIE ontology lineage must be retained even though domain-specific ontology is not generalized');
assert.ok(one.aoie_lineage.scoring_version, 'AOIE scoring lineage must be retained');
assert.ok(one.aoie_lineage.source_scoring_dimensions.includes('capability'));
assert.ok(one.aoie_lineage.reused_architecture.includes('HARD_DISQUALIFIERS'));
assert.match(one.aoie_lineage.adaptation, /electronics-specific ontology is not generalized/i);

const ranked = rankCandidates({ candidates: [relatedOnly, primary, corroborated], contractDna, businessSearchDna: searchDna });
assert.equal(ranked[0].business_name, 'Multi Path LLC', 'multi-path corroboration should improve ranking');
assert.equal(ranked[0].rank, 1);
assert.ok(ranked[0].qualification_score > ranked[2].qualification_score);

const openContract = { competition: {}, hard_constraints: { mandatory_requirements: [], registration_requirements: [], geographic_restrictions: [], manufacturer_supplier_restrictions: [], other: [] } };
const openSearch = { search_readiness: 'READY', hard_requirements: {}, qualification: { compare_set_aside_eligibility: false } };
const clear = qualifyCandidate({ candidate: corroborated, contractDna: openContract, businessSearchDna: openSearch });
assert.equal(clear.qualification_status, 'QUALIFIED', 'strong evidence with no unresolved hard gates can qualify');

const summary = qualificationSummary(ranked);
assert.equal(summary.total, 3);
assert.equal(summary.review_required, 3);
assert.equal(summary.disqualified, 0);

console.log('NGCC contractor qualification tests passed.');
