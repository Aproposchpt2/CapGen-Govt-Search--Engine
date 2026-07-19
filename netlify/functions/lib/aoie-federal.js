'use strict';

const ENGINE_VERSION = 'aoie-federal-mvp-1';
const ONTOLOGY_VERSION = 'federal-electronics-v1';
const SCORING_VERSION = 'federal-hybrid-v1';

const ELECTRONICS_ONTOLOGY = {
  semiconductor_device: {
    terms: ['semiconductor', 'microchip', 'computer chip', 'integrated circuit', 'asic', 'fpga', 'microelectronics', 'solid-state device', 'semiconductor device'],
    negativeTerms: ['brush chipper', 'wood chipper', 'paint chip', 'casino chip', 'potato chip'],
    relatedNaics: ['334413', '334418', '334419', '334511', '334290'],
    supplierNaics: ['423690', '423430', '423610'],
  },
  printed_circuit: {
    terms: ['printed circuit board', 'pcb', 'printed circuit assembly', 'circuit card assembly'],
    negativeTerms: [],
    relatedNaics: ['334412', '334418'],
    supplierNaics: ['423690', '423430'],
  },
  industrial_controls: {
    terms: ['industrial control', 'automation control', 'programmable logic controller', 'plc', 'control panel'],
    negativeTerms: [],
    relatedNaics: ['334513', '335314', '541512'],
    supplierNaics: ['423610', '423690'],
  },
};

const DEFAULT_WEIGHTS = {
  exactNaics: 25,
  relatedNaics: 15,
  capability: 25,
  supplierRole: 10,
  semanticEvidence: 10,
  setAside: 5,
  psc: 5,
  market: 3,
  geographyCapacity: 2,
};

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function includesPhrase(text, phrase) {
  return normalizeText(text).includes(normalizeText(phrase));
}

function detectConcepts(text) {
  const normalized = normalizeText(text);
  const concepts = [];
  Object.entries(ELECTRONICS_ONTOLOGY).forEach(([id, spec]) => {
    const negative = spec.negativeTerms.some((term) => includesPhrase(normalized, term));
    const evidence = spec.terms.filter((term) => includesPhrase(normalized, term));
    if (!negative && evidence.length) concepts.push({ id, evidence });
  });
  return concepts;
}

function expandBusinessProfile(profile) {
  const exactNaics = (profile.naics || profile.naics_codes || []).map((item) => String(item.code || item));
  const concepts = [];
  const roleIndicators = new Set();

  Object.entries(ELECTRONICS_ONTOLOGY).forEach(([id, spec]) => {
    const exactRelated = exactNaics.some((code) => spec.relatedNaics.includes(code));
    const supplierRelated = exactNaics.some((code) => spec.supplierNaics.includes(code));
    if (exactRelated || supplierRelated) {
      concepts.push({
        id,
        source: exactRelated ? 'NORMALIZED_MAPPING' : 'NORMALIZED_MAPPING',
        confidence: exactRelated ? 'HIGH' : 'MODERATE',
        evidence: exactNaics.filter((code) => spec.relatedNaics.includes(code) || spec.supplierNaics.includes(code)),
      });
    }
    if (supplierRelated) roleIndicators.add('DISTRIBUTOR_OR_WHOLESALER');
    if (exactRelated) roleIndicators.add('MANUFACTURER_OR_TECHNICAL_PROVIDER');
  });

  return {
    engine_version: ENGINE_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    profile_version: 'federal-capability-profile-v1',
    exact_naics: exactNaics,
    primary_naics: String(profile.primary_naics || ''),
    certifications: profile.set_asides || profile.certifications || [],
    state: profile.state || null,
    concepts,
    role_indicators: Array.from(roleIndicators),
  };
}

function extractOpportunityFeatures(opportunity) {
  const text = [opportunity.title, opportunity.description, opportunity.summary, opportunity.raw_text].filter(Boolean).join(' ');
  const concepts = detectConcepts(text);
  const normalized = normalizeText(text);
  const constraints = [];

  if (/manufacturer only|original equipment manufacturer only|oem only/.test(normalized)) constraints.push('MANUFACTURER_ONLY');
  if (/authorized distributor|approved source|qualified source/.test(normalized)) constraints.push('AUTHORIZED_SOURCE_VERIFICATION');
  if (/counterfeit|traceability|certificate of conformance/.test(normalized)) constraints.push('TRACEABILITY_VERIFICATION');

  return {
    engine_version: ENGINE_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    opportunity_naics: String(opportunity.naics_code || opportunity.naics || ''),
    psc: opportunity.psc || opportunity.product_service_code || null,
    concepts,
    constraints,
    evidence_text: text,
  };
}

function scoreMatch(capabilityProfile, opportunity, options = {}) {
  const weights = Object.assign({}, DEFAULT_WEIGHTS, options.weights || {});
  const features = extractOpportunityFeatures(opportunity);
  const signalScores = {};
  const reasons = [];
  const verify = [];
  const exactNaics = capabilityProfile.exact_naics || [];
  const opportunityNaics = features.opportunity_naics;

  signalScores.exact_naics = exactNaics.includes(opportunityNaics) ? weights.exactNaics : 0;
  if (signalScores.exact_naics) reasons.push('The opportunity NAICS appears directly in the contractor profile.');

  const matchedConcepts = features.concepts.filter((oppConcept) => capabilityProfile.concepts.some((businessConcept) => businessConcept.id === oppConcept.id));
  const relatedNaics = matchedConcepts.some((concept) => {
    const spec = ELECTRONICS_ONTOLOGY[concept.id];
    return spec && spec.relatedNaics.includes(opportunityNaics);
  });
  signalScores.related_naics = !signalScores.exact_naics && relatedNaics ? weights.relatedNaics : 0;
  if (signalScores.related_naics) reasons.push('The opportunity NAICS is related to a capability represented in the contractor profile.');

  signalScores.capability = matchedConcepts.length ? weights.capability : 0;
  if (matchedConcepts.length) reasons.push('Solicitation terminology aligns with contractor electronics capabilities: ' + matchedConcepts.map((c) => c.id.replace(/_/g, ' ')).join(', ') + '.');

  const supplierCompatible = matchedConcepts.some((concept) => {
    const spec = ELECTRONICS_ONTOLOGY[concept.id];
    return spec && exactNaics.some((code) => spec.supplierNaics.includes(code));
  });
  signalScores.supplier_role = supplierCompatible ? weights.supplierRole : 0;
  if (supplierCompatible) reasons.push('The contractor profile supports a distributor or wholesaler role for the requested product family.');

  signalScores.semantic_evidence = features.concepts.length ? weights.semanticEvidence : 0;
  signalScores.set_aside = weights.setAside;
  signalScores.psc = features.psc ? weights.psc : 0;
  signalScores.market = /dla|defense|navy|air force|nasa|nist|microelectronics/i.test(String(opportunity.agency || '')) ? weights.market : 0;
  signalScores.geography_capacity = weights.geographyCapacity;

  let hardDisqualifier = null;
  if (opportunity.response_deadline && !Number.isNaN(Date.parse(opportunity.response_deadline)) && new Date(opportunity.response_deadline) < new Date()) {
    hardDisqualifier = 'EXPIRED';
  }
  if (features.constraints.includes('MANUFACTURER_ONLY') && !capabilityProfile.role_indicators.includes('MANUFACTURER_OR_TECHNICAL_PROVIDER')) {
    hardDisqualifier = 'MANUFACTURER_ONLY_MISMATCH';
  }

  if (features.constraints.includes('AUTHORIZED_SOURCE_VERIFICATION')) verify.push('Confirm authorized-distributor or approved-source status.');
  if (features.constraints.includes('TRACEABILITY_VERIFICATION')) verify.push('Confirm traceability, counterfeit-parts controls, and certificate requirements.');
  if (matchedConcepts.length) verify.push('Confirm exact part number, approved manufacturer, quantity, and delivery schedule.');

  const rawScore = Object.values(signalScores).reduce((sum, value) => sum + value, 0);
  const fitScore = hardDisqualifier ? 0 : Math.min(100, rawScore);
  const confidence = features.concepts.length && exactNaics.length >= 3 ? 'HIGH' : features.concepts.length ? 'MODERATE' : 'LOW';
  const status = hardDisqualifier ? 'Not Recommended' : fitScore >= 85 ? 'Strong Match' : fitScore >= 70 ? 'Good Match' : fitScore >= 55 ? 'Review' : fitScore >= 40 ? 'Monitor' : 'Not Recommended';

  return {
    engine_version: ENGINE_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    scoring_version: SCORING_VERSION,
    fit_score: fitScore,
    confidence,
    match_status: status,
    hard_disqualifier: hardDisqualifier,
    signal_scores: signalScores,
    explanation: {
      why_matched: reasons,
      verify_before_pursuit: Array.from(new Set(verify)),
      concept_evidence: features.concepts,
    },
  };
}

module.exports = {
  ENGINE_VERSION,
  ONTOLOGY_VERSION,
  SCORING_VERSION,
  ELECTRONICS_ONTOLOGY,
  DEFAULT_WEIGHTS,
  detectConcepts,
  expandBusinessProfile,
  extractOpportunityFeatures,
  scoreMatch,
};
