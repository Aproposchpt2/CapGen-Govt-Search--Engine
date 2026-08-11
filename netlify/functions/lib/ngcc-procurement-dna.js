'use strict';

const clean = value => String(value ?? '').trim();
const cleanCode = value => clean(value).replace(/[^0-9]/g, '').slice(0, 6);
const cleanArray = values => [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
const cleanNaicsArray = values => [...new Set((Array.isArray(values) ? values : []).map(cleanCode).filter(code => /^\d{6}$/.test(code)))];

function first(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === 'object' && Object.keys(value).length) return value;
    if (clean(value)) return value;
  }
  return null;
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;
  return null;
}

function searchPath(code, source, priority) {
  return { naics_code: code, source, priority };
}

function buildNaicsSearchPaths({ samAssignedNaics, derivedPrimaryNaics, derivedRelatedNaics }) {
  const sam = cleanCode(samAssignedNaics);
  const primary = cleanCode(derivedPrimaryNaics);
  const related = cleanNaicsArray(derivedRelatedNaics);
  const seen = new Set();
  const paths = [];

  function add(code, source, priority) {
    if (!/^\d{6}$/.test(code) || seen.has(code)) return;
    seen.add(code);
    paths.push(searchPath(code, source, priority));
  }

  add(sam, 'sam_assigned', 1);
  add(primary, 'derived_primary', sam === primary ? 1 : 2);
  related.forEach((code, index) => add(code, 'derived_related', 3 + index));
  return paths;
}

function buildContractDna({ opportunity = {}, derivation = {}, requirements = {} } = {}) {
  const samAssignedNaics = cleanCode(first(
    opportunity.sam_assigned_naics,
    opportunity.naicsCode,
    opportunity.naics_code,
    derivation.sam_naics_code
  ));
  const derivedPrimaryNaics = cleanCode(first(
    derivation.derived_primary_naics,
    derivation.primary_naics
  ));
  const derivedRelatedNaics = cleanNaicsArray(first(
    derivation.derived_related_naics,
    derivation.additional_naics,
    []
  ));

  const searchPaths = buildNaicsSearchPaths({
    samAssignedNaics,
    derivedPrimaryNaics,
    derivedRelatedNaics,
  });

  const noticeId = clean(first(opportunity.noticeId, opportunity.notice_id, opportunity.notice_id_sam));
  const title = clean(first(opportunity.title, requirements.title));
  const agency = clean(first(opportunity.agency, opportunity.organizationName, opportunity.department, requirements.agency));
  const setAside = clean(first(opportunity.setAside, opportunity.set_aside, opportunity.typeOfSetAside, requirements.set_aside));
  const responseDeadline = clean(first(opportunity.responseDeadline, opportunity.response_deadline, requirements.response_deadline));

  return {
    schema_version: 'ngcc-contract-dna-v1',
    source: 'SAM.gov',
    notice_id: noticeId || null,
    solicitation_number: clean(first(opportunity.solicitationNumber, opportunity.solicitation_number)) || null,
    title: title || null,
    agency: agency || null,
    opportunity_type: clean(first(opportunity.type, opportunity.opportunity_type)) || null,
    posted_date: clean(first(opportunity.postedDate, opportunity.posted_date)) || null,
    response_deadline: responseDeadline || null,
    sam_url: clean(first(opportunity.samUrl, opportunity.sam_url, opportunity.uiLink)) || null,

    competition: {
      set_aside: setAside || null,
      eligible_business_classification: clean(first(
        requirements.eligible_business_classification,
        opportunity.eligible_business_classification
      )) || null,
    },

    requirement: {
      primary_requirement: clean(first(requirements.primary_requirement, requirements.summary, opportunity.description)) || null,
      products_services: cleanArray(first(requirements.products_services, [])),
      required_capabilities: cleanArray(first(requirements.required_capabilities, requirements.capabilities, [])),
      required_experience: cleanArray(first(requirements.required_experience, [])),
      required_certifications: cleanArray(first(requirements.required_certifications, [])),
      supplier_role: clean(first(requirements.supplier_role, opportunity.supplier_role)) || null,
      place_of_performance: first(requirements.place_of_performance, opportunity.place_of_performance, null),
    },

    classification: {
      sam_assigned_naics: samAssignedNaics || null,
      derived_primary_naics: derivedPrimaryNaics || null,
      derived_related_naics: derivedRelatedNaics,
      sam_naics_confirmed: booleanOrNull(first(
        derivation.sam_naics_confirmed,
        derivation.confirms_sam_code
      )),
      derivation_rationale: clean(first(derivation.derivation_rationale, derivation.rationale)) || null,
      requirements_evidence_used: Boolean(first(
        derivation.requirements_evidence_used,
        derivation.description_used,
        requirements.requirements_evidence_used
      )),
      psc: clean(first(requirements.psc, opportunity.psc, opportunity.classificationCode)) || null,
      procurement_keywords: cleanArray(first(requirements.procurement_keywords, requirements.keywords, [])),
      procurement_language: cleanArray(first(requirements.procurement_language, [])),
      naics_search_paths: searchPaths,
    },

    hard_constraints: {
      mandatory_requirements: cleanArray(first(requirements.mandatory_requirements, [])),
      registration_requirements: cleanArray(first(requirements.registration_requirements, [])),
      geographic_restrictions: cleanArray(first(requirements.geographic_restrictions, [])),
      manufacturer_supplier_restrictions: cleanArray(first(requirements.manufacturer_supplier_restrictions, [])),
      other: cleanArray(first(requirements.other_hard_constraints, requirements.hard_constraints, [])),
    },

    confidence: clean(first(requirements.confidence, derivation.confidence)) || null,
    evidence: Array.isArray(requirements.evidence) ? requirements.evidence : [],
    search_readiness: searchPaths.length ? 'READY' : 'REVIEW_REQUIRED',
  };
}

function buildBusinessSearchDna(contractDna = {}) {
  const classification = contractDna.classification || {};
  const requirement = contractDna.requirement || {};
  const competition = contractDna.competition || {};
  const hardConstraints = contractDna.hard_constraints || {};
  const naicsPaths = Array.isArray(classification.naics_search_paths)
    ? classification.naics_search_paths
    : buildNaicsSearchPaths({
        samAssignedNaics: classification.sam_assigned_naics,
        derivedPrimaryNaics: classification.derived_primary_naics,
        derivedRelatedNaics: classification.derived_related_naics,
      });

  return {
    schema_version: 'ngcc-business-search-dna-v1',
    contract_notice_id: contractDna.notice_id || null,
    contract_title: contractDna.title || null,
    source: 'SAM.gov Entity Management',
    hard_requirements: {
      active_sam_registration: true,
      set_aside_compatibility_required: Boolean(competition.set_aside),
      required_business_classification: competition.eligible_business_classification || competition.set_aside || null,
      no_known_hard_disqualifier: true,
      registration_valid_for_pursuit: true,
    },
    retrieval: {
      naics_search_paths: naicsPaths,
      search_naics: naicsPaths.map(path => path.naics_code),
      capability_terms: cleanArray(requirement.required_capabilities),
      products_services: cleanArray(requirement.products_services),
      procurement_keywords: cleanArray(classification.procurement_keywords),
      procurement_language: cleanArray(classification.procurement_language),
      psc: classification.psc || null,
      supplier_role: requirement.supplier_role || null,
      place_of_performance: requirement.place_of_performance || null,
    },
    qualification: {
      compare_exact_naics: true,
      compare_related_naics: true,
      compare_capability_alignment: true,
      compare_supplier_role: true,
      compare_set_aside_eligibility: true,
      compare_psc_alignment: Boolean(classification.psc),
      compare_semantic_evidence: true,
      compare_geography_capacity: Boolean(requirement.place_of_performance),
      mandatory_requirements: cleanArray(hardConstraints.mandatory_requirements),
      registration_requirements: cleanArray(hardConstraints.registration_requirements),
      geographic_restrictions: cleanArray(hardConstraints.geographic_restrictions),
      manufacturer_supplier_restrictions: cleanArray(hardConstraints.manufacturer_supplier_restrictions),
      other_hard_constraints: cleanArray(hardConstraints.other),
    },
    output_contract: {
      ranked_candidates: true,
      explainable_match_evidence: true,
      search_path_attribution: true,
      operator_review_required: true,
    },
    search_readiness: naicsPaths.length ? 'READY' : 'REVIEW_REQUIRED',
  };
}

module.exports = {
  cleanCode,
  cleanNaicsArray,
  buildNaicsSearchPaths,
  buildContractDna,
  buildBusinessSearchDna,
};
