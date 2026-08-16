'use strict';

const assert = require('node:assert/strict');
const {
  discoveryAssessment,
  qualifyCandidate,
  rankCandidates,
  qualificationSummary,
} = require('../netlify/functions/lib/ngcc-contractor-qualification');

const contractDna = {
  classification: { sam_assigned_naics: '611620' },
  competition: { set_aside: 'Total Small Business Set-Aside', eligible_business_classification: 'Small Business' },
  requirement: {
    primary_requirement: 'Provide certified aerobics instructors.',
    supplier_role: 'Prime contractor providing aerobics instruction services.',
    place_of_performance: 'Nellis AFB, NV',
    required_certifications: ['Certified aerobics instructors'],
    required_experience: ['Relevant group exercise instruction experience'],
  },
  hard_constraints: {
    mandatory_requirements: ['Provide certified instructors', 'Provide recurring scheduled classes'],
    registration_requirements: [],
    geographic_restrictions: [],
    manufacturer_supplier_restrictions: [],
    other: [],
  },
};

const searchDna = {
  search_readiness: 'READY',
  hard_requirements: { required_business_classification: 'Small Business' },
  qualification: { compare_set_aside_eligibility: true },
};

function baselineCandidate(overrides = {}) {
  return {
    candidate_number: 1,
    ueiSAM: 'UEI-PRIMARY',
    cageCode: '1ABC2',
    businessName: 'Primary Path LLC',
    state: 'NV',
    registration_status: 'Active',
    registered_naics: [{ naics_code: '611620', is_primary: true, sba_small_business: 'Y' }],
    business_classifications: ['Small Business'],
    matched_search_paths: [{ naics_code: '611620', source: 'sam_assigned', priority: 1 }],
    ...overrides,
  };
}

const baseline = baselineCandidate();
const discovery = discoveryAssessment(baseline);
assert.equal(discovery.score, 85, 'exact current SAM NAICS + active registration + identity should create a strong discovery match');
assert.equal(discovery.status, 'STRONG');

const unverified = qualifyCandidate({ candidate: baseline, contractDna, businessSearchDna: searchDna });
assert.equal(unverified.discovery_match_score, 85);
assert.equal(unverified.qualification_score, null, 'retrieval evidence alone must not produce a contract-fit score');
assert.equal(unverified.qualification_status, 'INSUFFICIENT_EVIDENCE');
assert.match(unverified.explanation.why_ranked.join(' '), /Discovery Match 85\/100/);
assert.match(unverified.explanation.why_ranked.join(' '), /not scored/i);
assert.equal(unverified.aoie_lineage.source_asset, 'netlify/functions/lib/aoie-federal.js');
assert.match(unverified.aoie_lineage.adaptation, /NAICS registration is treated as a discovery signal/i);

const fullySupported = baselineCandidate({
  businessName: 'Verified Fitness LLC',
  ueiSAM: 'UEI-VERIFIED',
  cageCode: '2ABC3',
  capability_verification: {
    status: 'VERIFIED',
    sources: [{ url: 'https://example.com/capabilities', title: 'Capabilities' }],
    dimensions: {
      current_capability_alignment: { status: 'SUPPORTED', reason: 'Current website offers aerobics instruction.', sources: [{ url: 'https://example.com/capabilities' }] },
      mandatory_requirements: { status: 'SUPPORTED', reason: 'Current evidence supports the mandatory service requirements.', sources: [{ url: 'https://example.com/capabilities' }] },
      certifications_licenses: { status: 'SUPPORTED', reason: 'Current instructor certification evidence was found.', sources: [{ url: 'https://example.com/certifications' }] },
      past_performance: { status: 'SUPPORTED', reason: 'Relevant performed work was identified.', sources: [{ url: 'https://example.com/past-performance' }] },
      set_aside_classification: { status: 'UNVERIFIED', reason: 'SAM evidence will be evaluated separately.', sources: [] },
      geography_capacity: { status: 'SUPPORTED', reason: 'Current service area includes the place of performance.', sources: [{ url: 'https://example.com/service-area' }] },
      supplier_role: { status: 'SUPPORTED', reason: 'Business directly provides the required service.', sources: [{ url: 'https://example.com/capabilities' }] },
    },
  },
});

const verified = qualifyCandidate({ candidate: fullySupported, contractDna, businessSearchDna: searchDna });
assert.equal(verified.qualification_status, 'QUALIFIED');
assert.equal(verified.qualification_score, 100);
assert.equal(verified.evidence_coverage_percentage, 100);

const mismatch = baselineCandidate({
  businessName: 'Unrelated Services LLC',
  ueiSAM: 'UEI-MISMATCH',
  cageCode: '3ABC4',
  capability_verification: {
    status: 'PARTIAL',
    sources: [{ url: 'https://example.org/current-services' }],
    dimensions: {
      current_capability_alignment: { status: 'MISMATCH', reason: 'Current official site describes unrelated services only.', sources: [{ url: 'https://example.org/current-services' }] },
      mandatory_requirements: { status: 'UNVERIFIED', sources: [] },
      certifications_licenses: { status: 'UNVERIFIED', sources: [] },
      past_performance: { status: 'UNVERIFIED', sources: [] },
      set_aside_classification: { status: 'UNVERIFIED', sources: [] },
      geography_capacity: { status: 'UNVERIFIED', sources: [] },
      supplier_role: { status: 'UNVERIFIED', sources: [] },
    },
  },
});
const disqualified = qualifyCandidate({ candidate: mismatch, contractDna, businessSearchDna: searchDna });
assert.equal(disqualified.qualification_status, 'DISQUALIFIED');
assert.equal(disqualified.qualification_score, 0);

const multiPath = baselineCandidate({
  businessName: 'Multi Path LLC',
  ueiSAM: 'UEI-MULTI',
  cageCode: '4ABC5',
  matched_search_paths: [
    { naics_code: '611620', source: 'sam_assigned', priority: 1 },
    { naics_code: '611699', source: 'derived_related', priority: 3 },
  ],
});
const multiDiscovery = discoveryAssessment(multiPath);
assert.equal(multiDiscovery.score, 100, 'multi-path corroboration should improve discovery confidence');

const ranked = rankCandidates({ candidates: [baseline, multiPath, fullySupported, mismatch], contractDna, businessSearchDna: searchDna });
assert.equal(ranked[0].business_name, 'Verified Fitness LLC', 'verified contract capability must outrank discovery-only candidates');
assert.equal(ranked[1].business_name, 'Multi Path LLC', 'among insufficient-evidence candidates, stronger discovery evidence should rank first');
assert.equal(ranked[3].business_name, 'Unrelated Services LLC', 'affirmative capability mismatch should rank last');

const summary = qualificationSummary(ranked);
assert.equal(summary.total, 4);
assert.equal(summary.qualified, 1);
assert.equal(summary.insufficient_evidence, 2);
assert.equal(summary.disqualified, 1);
assert.equal(summary.top_score, 100);
assert.equal(summary.top_discovery_score, 100);

console.log('NGCC contractor qualification v2 tests passed.');
