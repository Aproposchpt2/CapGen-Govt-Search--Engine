'use strict';

const {
  ENGINE_VERSION: AOIE_ENGINE_VERSION,
  ONTOLOGY_VERSION: AOIE_ONTOLOGY_VERSION,
  SCORING_VERSION: AOIE_SCORING_VERSION,
  DEFAULT_WEIGHTS: AOIE_DEFAULT_WEIGHTS,
} = require('./aoie-federal');

const QUALIFICATION_VERSION = 'ngcc-contractor-qualification-v2';

// Discovery answers: "why did NGCC find this business?"
const DISCOVERY_WEIGHTS = Object.freeze({
  samAssignedNaics: 40,
  derivedPrimaryNaics: 30,
  derivedRelatedNaics: 20,
  multipleSearchPaths: 15,
  activeSamRegistration: 15,
  ueiAndCage: 10,
  currentNaicsCorroboration: 20,
});

// Qualification answers: "what evidence shows this business can perform this contract?"
// Scores are normalized over only the dimensions that apply to the contract.
const QUALIFICATION_WEIGHTS = Object.freeze({
  current_capability_alignment: 35,
  mandatory_requirements: 20,
  certifications_licenses: 15,
  past_performance: 10,
  set_aside_classification: 10,
  geography_capacity: 5,
  supplier_role: 5,
  current_naics_alignment: 5,
});

const QUALIFIED_THRESHOLD = 70;
const MIN_EVIDENCE_COVERAGE = 55;
const KNOWN_STATUSES = new Set(['SUPPORTED', 'MISMATCH']);

const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();
const unique = values => [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];

function candidatePaths(candidate = {}) {
  return Array.isArray(candidate.matched_search_paths) ? candidate.matched_search_paths : [];
}

function pathScore(path = {}) {
  if (path.source === 'sam_assigned') return DISCOVERY_WEIGHTS.samAssignedNaics;
  if (path.source === 'derived_primary') return DISCOVERY_WEIGHTS.derivedPrimaryNaics;
  if (path.source === 'derived_related') return DISCOVERY_WEIGHTS.derivedRelatedNaics;
  return 0;
}

function strongestPath(candidate = {}) {
  return candidatePaths(candidate)
    .slice()
    .sort((a, b) => pathScore(b) - pathScore(a) || Number(a.priority || 99) - Number(b.priority || 99))[0] || null;
}

function containsStateRestriction(restrictions, state) {
  const s = upper(state);
  if (!s) return false;
  return restrictions.some(item => {
    const text = upper(item);
    return text === s || text.includes(` ${s} `) || text.endsWith(` ${s}`) || text.startsWith(`${s} `);
  });
}

function registeredNaics(candidate = {}) {
  const source = candidate.registered_naics || candidate.naics_list || candidate.naicsList || [];
  return (Array.isArray(source) ? source : []).map(item => {
    if (typeof item === 'string') return { naics_code: clean(item), is_primary: false, sba_small_business: null };
    return {
      naics_code: clean(item.naics_code || item.naicsCode),
      description: clean(item.description || item.naics_description || item.naicsDescription || item.naicsName) || null,
      is_primary: Boolean(item.is_primary || item.isPrimary === 'Y' || item.isPrimary === true),
      sba_small_business: item.sba_small_business ?? item.sbaSmallBusiness ?? item.isSmallBusiness ?? null,
    };
  }).filter(item => item.naics_code);
}

function yesLike(value) {
  return ['Y', 'YES', 'TRUE', '1'].includes(upper(value));
}

function normalizeEvidenceStatus(value) {
  const status = upper(value);
  if (status === 'SUPPORTED' || status === 'MISMATCH' || status === 'NOT_APPLICABLE') return status;
  return 'UNVERIFIED';
}

function discoveryAssessment(candidate = {}) {
  const paths = candidatePaths(candidate);
  const strongest = strongestPath(candidate);
  const hasUei = Boolean(clean(candidate.ueiSAM || candidate.uei));
  const hasCage = Boolean(clean(candidate.cageCode || candidate.cage_code));
  const naics = registeredNaics(candidate);
  const currentNaicsMatch = Boolean(strongest && naics.some(item => item.naics_code === clean(strongest.naics_code)));
  const signals = {
    naics_search_path: strongest ? pathScore(strongest) : 0,
    multiple_search_paths: paths.length > 1 ? DISCOVERY_WEIGHTS.multipleSearchPaths : 0,
    active_sam_registration: candidate.registration_status === 'Inactive' ? 0 : DISCOVERY_WEIGHTS.activeSamRegistration,
    federal_identity: hasUei && hasCage ? DISCOVERY_WEIGHTS.ueiAndCage : 0,
    current_naics_corroboration: currentNaicsMatch ? DISCOVERY_WEIGHTS.currentNaicsCorroboration : 0,
  };
  const score = Math.min(100, Object.values(signals).reduce((sum, value) => sum + Number(value || 0), 0));
  const status = score >= 80 ? 'STRONG' : score >= 55 ? 'MODERATE' : 'WEAK';
  return { score, status, signals, strongest_path: strongest, current_naics_match: currentNaicsMatch };
}

function requiredClassification(contractDna = {}, businessSearchDna = {}) {
  return clean(
    contractDna.competition?.eligible_business_classification ||
    contractDna.competition?.set_aside ||
    businessSearchDna.hard_requirements?.required_business_classification
  );
}

function samSetAsideEvidence(contractDna = {}, businessSearchDna = {}, candidate = {}) {
  const required = requiredClassification(contractDna, businessSearchDna);
  if (!required) return { status: 'NOT_APPLICABLE', reason: 'No contract-specific business classification requirement was identified.' };

  const requiredUpper = upper(required);
  const classifications = unique(candidate.business_classifications || candidate.certifications || candidate.set_asides);
  const classificationText = classifications.map(upper).join(' | ');
  const exactNaics = clean(contractDna.classification?.sam_assigned_naics || contractDna.classification?.derived_primary_naics || strongestPath(candidate)?.naics_code);
  const naicsRecord = registeredNaics(candidate).find(item => item.naics_code === exactNaics);

  const specializedChecks = [
    { pattern: /SERVICE[- ]?DISABLED.*VETERAN|SDVOSB/, candidate: /SERVICE[- ]?DISABLED.*VETERAN|SDVOSB/ },
    { pattern: /WOMEN.*SMALL|WOMAN.*SMALL|WOSB/, candidate: /WOMEN.*SMALL|WOMAN.*SMALL|WOSB/ },
    { pattern: /ECONOMICALLY.*WOMEN|EDWOSB/, candidate: /ECONOMICALLY.*WOMEN|EDWOSB/ },
    { pattern: /HUBZONE/, candidate: /HUBZONE/ },
    { pattern: /8\s*\(?A\)?/, candidate: /8\s*\(?A\)?/ },
    { pattern: /VETERAN.*OWNED|VOSB/, candidate: /VETERAN.*OWNED|VOSB/ },
  ];
  const specialized = specializedChecks.find(check => check.pattern.test(requiredUpper));
  if (specialized) {
    if (specialized.candidate.test(classificationText)) {
      return { status: 'SUPPORTED', reason: 'Current SAM business-type evidence appears compatible with the stated set-aside classification.' };
    }
    return { status: 'UNVERIFIED', reason: 'The public SAM business-type evidence retrieved does not prove the specialized set-aside classification.' };
  }

  if (requiredUpper.includes('SMALL BUSINESS')) {
    if (naicsRecord && yesLike(naicsRecord.sba_small_business)) {
      return { status: 'SUPPORTED', reason: `SAM assertions indicate SBA small-business status for NAICS ${exactNaics}.` };
    }
    if (classificationText.includes('SMALL BUSINESS')) {
      return { status: 'SUPPORTED', reason: 'SAM business-type evidence indicates a small-business classification.' };
    }
    return { status: 'UNVERIFIED', reason: 'Current public SAM evidence does not establish the required small-business classification for this contract.' };
  }

  if (classificationText && classifications.some(value => requiredUpper.includes(upper(value)) || upper(value).includes(requiredUpper))) {
    return { status: 'SUPPORTED', reason: 'SAM business-type evidence appears compatible with the stated competition classification.' };
  }
  return { status: 'UNVERIFIED', reason: 'The retrieved SAM business-type evidence does not establish the required competition classification.' };
}

function webDimension(candidate = {}, key) {
  const verification = candidate.capability_verification && typeof candidate.capability_verification === 'object'
    ? candidate.capability_verification
    : {};
  const dimension = verification.dimensions?.[key] || {};
  return {
    status: normalizeEvidenceStatus(dimension.status),
    reason: clean(dimension.reason) || null,
    sources: Array.isArray(dimension.sources) ? dimension.sources : [],
  };
}

function aggregateRequirementStatus(items = []) {
  const statuses = (Array.isArray(items) ? items : []).map(item => normalizeEvidenceStatus(item.status));
  if (!statuses.length) return 'UNVERIFIED';
  if (statuses.includes('MISMATCH')) return 'MISMATCH';
  if (statuses.every(status => status === 'SUPPORTED')) return 'SUPPORTED';
  return 'UNVERIFIED';
}

function contractDimensions(contractDna = {}, businessSearchDna = {}, candidate = {}) {
  const hard = contractDna.hard_constraints || {};
  const requirement = contractDna.requirement || {};
  const geographicRestrictions = unique(hard.geographic_restrictions);
  const mandatoryRequirements = unique(hard.mandatory_requirements);
  const requiredCertifications = unique(requirement.required_certifications);
  const requiredExperience = unique(requirement.required_experience);
  const supplierRole = clean(requirement.supplier_role);
  const manufacturerSupplierRestrictions = unique(hard.manufacturer_supplier_restrictions);
  const placeOfPerformance = clean(requirement.place_of_performance);
  const requiredClass = requiredClassification(contractDna, businessSearchDna);
  const strongest = strongestPath(candidate);
  const currentNaics = strongest && registeredNaics(candidate).some(item => item.naics_code === clean(strongest.naics_code));

  const capability = webDimension(candidate, 'current_capability_alignment');
  const mandatory = webDimension(candidate, 'mandatory_requirements');
  const certifications = webDimension(candidate, 'certifications_licenses');
  const pastPerformance = webDimension(candidate, 'past_performance');
  const geographyWeb = webDimension(candidate, 'geography_capacity');
  const supplier = webDimension(candidate, 'supplier_role');
  const setAsideWeb = webDimension(candidate, 'set_aside_classification');
  const samSetAside = samSetAsideEvidence(contractDna, businessSearchDna, candidate);

  const geography = geographyWeb.status !== 'UNVERIFIED'
    ? geographyWeb
    : geographicRestrictions.length && containsStateRestriction(geographicRestrictions, candidate.state)
      ? { status: 'SUPPORTED', reason: `Candidate state ${clean(candidate.state)} appears in the stated geographic restriction.`, sources: [] }
      : geographyWeb;

  const setAside = samSetAside.status === 'SUPPORTED' ? { ...samSetAside, sources: [] } : setAsideWeb;

  return {
    current_capability_alignment: { applicable: true, weight: QUALIFICATION_WEIGHTS.current_capability_alignment, ...capability },
    mandatory_requirements: {
      applicable: mandatoryRequirements.length > 0,
      weight: QUALIFICATION_WEIGHTS.mandatory_requirements,
      requirements: mandatoryRequirements,
      ...mandatory,
    },
    certifications_licenses: {
      applicable: requiredCertifications.length > 0,
      weight: QUALIFICATION_WEIGHTS.certifications_licenses,
      requirements: requiredCertifications,
      ...certifications,
    },
    past_performance: {
      applicable: true,
      weight: QUALIFICATION_WEIGHTS.past_performance,
      requirements: requiredExperience,
      ...pastPerformance,
    },
    set_aside_classification: {
      applicable: Boolean(requiredClass),
      weight: QUALIFICATION_WEIGHTS.set_aside_classification,
      requirement: requiredClass || null,
      ...setAside,
    },
    geography_capacity: {
      applicable: Boolean(geographicRestrictions.length || placeOfPerformance),
      weight: QUALIFICATION_WEIGHTS.geography_capacity,
      requirement: geographicRestrictions.length ? geographicRestrictions.join('; ') : placeOfPerformance || null,
      ...geography,
    },
    supplier_role: {
      applicable: Boolean(supplierRole || manufacturerSupplierRestrictions.length),
      weight: QUALIFICATION_WEIGHTS.supplier_role,
      requirement: supplierRole || manufacturerSupplierRestrictions.join('; ') || null,
      ...supplier,
    },
    current_naics_alignment: {
      applicable: true,
      weight: QUALIFICATION_WEIGHTS.current_naics_alignment,
      status: currentNaics ? 'SUPPORTED' : 'UNVERIFIED',
      reason: currentNaics
        ? `Current SAM assertions include the discovery NAICS ${clean(strongest?.naics_code)}.`
        : 'Current SAM assertions did not provide enough evidence to corroborate the discovery NAICS.',
      sources: [],
    },
  };
}

function qualificationAssessment(contractDna = {}, businessSearchDna = {}, candidate = {}) {
  const dimensions = contractDimensions(contractDna, businessSearchDna, candidate);
  const applicable = Object.entries(dimensions).filter(([, item]) => item.applicable);
  const applicableWeight = applicable.reduce((sum, [, item]) => sum + item.weight, 0) || 1;
  const knownWeight = applicable.reduce((sum, [, item]) => sum + (KNOWN_STATUSES.has(item.status) ? item.weight : 0), 0);
  const supportedWeight = applicable.reduce((sum, [, item]) => sum + (item.status === 'SUPPORTED' ? item.weight : 0), 0);
  const coverage = Math.round((knownWeight / applicableWeight) * 100);
  const normalizedScore = Math.round((supportedWeight / applicableWeight) * 100);

  const hardMismatchKeys = new Set(['current_capability_alignment', 'mandatory_requirements', 'certifications_licenses', 'set_aside_classification', 'supplier_role', 'current_naics_alignment']);
  if ((contractDna.hard_constraints?.geographic_restrictions || []).length) hardMismatchKeys.add('geography_capacity');
  if ((contractDna.requirement?.required_experience || []).length) hardMismatchKeys.add('past_performance');

  const mismatches = applicable.filter(([key, item]) => hardMismatchKeys.has(key) && item.status === 'MISMATCH');
  const unresolvedHard = applicable.filter(([key, item]) => hardMismatchKeys.has(key) && item.status === 'UNVERIFIED');
  const capabilityStatus = dimensions.current_capability_alignment.status;

  let qualificationStatus;
  let score = null;
  if (mismatches.length) {
    qualificationStatus = 'DISQUALIFIED';
    score = 0;
  } else if (capabilityStatus !== 'SUPPORTED' || coverage < MIN_EVIDENCE_COVERAGE) {
    qualificationStatus = 'INSUFFICIENT_EVIDENCE';
  } else {
    score = normalizedScore;
    qualificationStatus = unresolvedHard.length === 0 && score >= QUALIFIED_THRESHOLD ? 'QUALIFIED' : 'REVIEW_REQUIRED';
  }

  const sourceCount = unique(
    applicable.flatMap(([, item]) => (item.sources || []).map(source => source.url || source))
  ).length;
  const confidence = coverage >= 80 && sourceCount >= 2 ? 'HIGH' : coverage >= 55 ? 'MODERATE' : 'LOW';

  return {
    score,
    status: qualificationStatus,
    evidence_coverage_percentage: coverage,
    normalized_supported_score: normalizedScore,
    confidence,
    dimensions,
    hard_mismatches: mismatches.map(([key]) => key),
    unresolved_hard_gates: unresolvedHard.map(([key]) => key),
    source_count: sourceCount,
  };
}

function verificationItems(contractDna = {}, businessSearchDna = {}, candidate = {}, assessment = null) {
  const qualification = assessment || qualificationAssessment(contractDna, businessSearchDna, candidate);
  return Object.entries(qualification.dimensions)
    .filter(([, item]) => item.applicable)
    .map(([code, item]) => ({
      code: upper(code),
      requirement: item.requirement || (item.requirements || []).join('; ') || code.replace(/_/g, ' '),
      status: item.status,
      reason: item.reason || (item.status === 'SUPPORTED' ? 'Supporting evidence was found.' : 'Current evidence is insufficient to establish this dimension.'),
      sources: item.sources || [],
    }));
}

function aoieLineage() {
  return {
    source_asset: 'netlify/functions/lib/aoie-federal.js',
    engine_version: AOIE_ENGINE_VERSION,
    ontology_version: AOIE_ONTOLOGY_VERSION,
    scoring_version: AOIE_SCORING_VERSION,
    source_scoring_dimensions: Object.keys(AOIE_DEFAULT_WEIGHTS || {}),
    reused_architecture: ['WEIGHTED_SIGNALS', 'HARD_DISQUALIFIERS', 'SEPARATE_CONFIDENCE', 'EXPLAINABLE_EVIDENCE'],
    adaptation: 'Contractor qualification separates retrieval/discovery evidence from contract-performance evidence. NAICS registration is treated as a discovery signal, not proof of current capability.',
  };
}

function qualifyCandidate({ candidate = {}, contractDna = {}, businessSearchDna = {} } = {}) {
  const discovery = discoveryAssessment(candidate);
  const qualification = qualificationAssessment(contractDna, businessSearchDna, candidate);
  const verification = verificationItems(contractDna, businessSearchDna, candidate, qualification);
  const reasons = [];
  const evidence = [];

  if (discovery.strongest_path) {
    const label = discovery.strongest_path.source === 'sam_assigned'
      ? 'SAM-assigned NAICS'
      : discovery.strongest_path.source === 'derived_primary'
        ? 'requirements-derived primary NAICS'
        : 'requirements-derived related NAICS';
    reasons.push(`Discovery Match ${discovery.score}/100 (${discovery.status}): candidate was found through the ${label} search path (${discovery.strongest_path.naics_code}).`);
    evidence.push({ type: 'DISCOVERY_NAICS_PATH', source: discovery.strongest_path.source, value: discovery.strongest_path.naics_code });
  }
  if (candidatePaths(candidate).length > 1) reasons.push(`Discovery was corroborated through ${candidatePaths(candidate).length} approved NAICS search paths.`);
  if (discovery.current_naics_match) reasons.push('Current SAM assertions corroborate the discovery NAICS.');

  if (qualification.status === 'INSUFFICIENT_EVIDENCE') {
    reasons.push(`Contract Qualification is not scored because evidence coverage is ${qualification.evidence_coverage_percentage}% and current capability must be affirmatively supported.`);
  } else {
    reasons.push(`Contract Qualification ${qualification.score}/100 with ${qualification.evidence_coverage_percentage}% evidence coverage.`);
  }

  const sourceEvidence = candidate.capability_verification?.sources || [];
  sourceEvidence.forEach(source => evidence.push({ type: 'PUBLIC_CAPABILITY_SOURCE', ...source }));

  return {
    qualification_version: QUALIFICATION_VERSION,
    aoie_lineage: aoieLineage(),
    candidate_number: candidate.candidate_number || null,
    uei: candidate.ueiSAM || candidate.uei || null,
    cage_code: candidate.cageCode || candidate.cage_code || null,
    business_name: candidate.businessName || candidate.business_name || null,
    city: candidate.city || null,
    state: candidate.state || null,
    discovery_match_score: discovery.score,
    discovery_match_status: discovery.status,
    discovery_signal_scores: discovery.signals,
    qualification_score: qualification.score,
    contract_qualification_score: qualification.score,
    qualification_status: qualification.status,
    evidence_coverage_percentage: qualification.evidence_coverage_percentage,
    confidence: qualification.confidence,
    signal_scores: qualification.dimensions,
    matched_search_paths: candidatePaths(candidate),
    registered_naics: registeredNaics(candidate),
    business_classifications: unique(candidate.business_classifications),
    capability_verification: candidate.capability_verification || null,
    explanation: {
      why_ranked: reasons,
      verification_required: verification,
      evidence,
    },
    operator_disposition: 'PENDING',
  };
}

function rankCandidates({ candidates = [], contractDna = {}, businessSearchDna = {} } = {}) {
  const statusOrder = { QUALIFIED: 4, REVIEW_REQUIRED: 3, INSUFFICIENT_EVIDENCE: 2, DISQUALIFIED: 1 };
  return (Array.isArray(candidates) ? candidates : [])
    .map(candidate => qualifyCandidate({ candidate, contractDna, businessSearchDna }))
    .sort((a, b) => {
      const statusDiff = (statusOrder[b.qualification_status] || 0) - (statusOrder[a.qualification_status] || 0);
      if (statusDiff) return statusDiff;
      const aScore = Number.isFinite(a.qualification_score) ? a.qualification_score : -1;
      const bScore = Number.isFinite(b.qualification_score) ? b.qualification_score : -1;
      if (bScore !== aScore) return bScore - aScore;
      if (b.discovery_match_score !== a.discovery_match_score) return b.discovery_match_score - a.discovery_match_score;
      return clean(a.business_name).localeCompare(clean(b.business_name));
    })
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));
}

function qualificationSummary(ranked = []) {
  const counts = { QUALIFIED: 0, REVIEW_REQUIRED: 0, INSUFFICIENT_EVIDENCE: 0, DISQUALIFIED: 0 };
  ranked.forEach(item => { counts[item.qualification_status] = (counts[item.qualification_status] || 0) + 1; });
  const scored = ranked.filter(item => Number.isFinite(item.qualification_score));
  return {
    total: ranked.length,
    qualified: counts.QUALIFIED || 0,
    review_required: counts.REVIEW_REQUIRED || 0,
    insufficient_evidence: counts.INSUFFICIENT_EVIDENCE || 0,
    disqualified: counts.DISQUALIFIED || 0,
    top_score: scored.length ? Math.max(...scored.map(item => item.qualification_score)) : null,
    top_discovery_score: ranked.length ? Math.max(...ranked.map(item => item.discovery_match_score || 0)) : null,
  };
}

module.exports = {
  QUALIFICATION_VERSION,
  DISCOVERY_WEIGHTS,
  QUALIFICATION_WEIGHTS,
  QUALIFIED_THRESHOLD,
  MIN_EVIDENCE_COVERAGE,
  aoieLineage,
  discoveryAssessment,
  qualificationAssessment,
  qualifyCandidate,
  rankCandidates,
  qualificationSummary,
  normalizeEvidenceStatus,
};
