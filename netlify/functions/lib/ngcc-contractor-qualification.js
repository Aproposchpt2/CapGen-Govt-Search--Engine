'use strict';

const {
  ENGINE_VERSION: AOIE_ENGINE_VERSION,
  ONTOLOGY_VERSION: AOIE_ONTOLOGY_VERSION,
  SCORING_VERSION: AOIE_SCORING_VERSION,
  DEFAULT_WEIGHTS: AOIE_DEFAULT_WEIGHTS,
} = require('./aoie-federal');

const QUALIFICATION_VERSION = 'ngcc-contractor-qualification-v1';
const WEIGHTS = {
  samAssignedNaics: 35,
  derivedPrimaryNaics: 30,
  derivedRelatedNaics: 20,
  multipleSearchPaths: 10,
  activeSamRegistration: 10,
  ueiAndCage: 5,
  geographyEvidence: 5,
  businessClassificationEvidence: 10,
};
const QUALIFIED_THRESHOLD = 60;

const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();
const unique = values => [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];

function candidatePaths(candidate = {}) { return Array.isArray(candidate.matched_search_paths) ? candidate.matched_search_paths : []; }
function pathScore(path = {}) {
  if (path.source === 'sam_assigned') return WEIGHTS.samAssignedNaics;
  if (path.source === 'derived_primary') return WEIGHTS.derivedPrimaryNaics;
  if (path.source === 'derived_related') return WEIGHTS.derivedRelatedNaics;
  return 0;
}
function strongestPath(candidate = {}) { return candidatePaths(candidate).slice().sort((a,b)=>pathScore(b)-pathScore(a)||Number(a.priority||99)-Number(b.priority||99))[0]||null; }
function containsStateRestriction(restrictions, state) {
  const s=upper(state); if(!s)return false;
  return restrictions.some(item=>{const text=upper(item);return text===s||text.includes(` ${s} `)||text.endsWith(` ${s}`)||text.startsWith(`${s} `);});
}
function verificationItems(contractDna = {}, searchDna = {}, candidate = {}) {
  const hard=contractDna.hard_constraints||{}, competition=contractDna.competition||{}, qualification=searchDna.qualification||{}, items=[];
  if(competition.set_aside||qualification.compare_set_aside_eligibility)items.push({code:'SET_ASIDE_ELIGIBILITY',requirement:competition.set_aside||qualification.required_business_classification||'Applicable set-aside/business classification',status:'UNVERIFIED',reason:'The controlled SAM discovery response does not yet prove this candidate satisfies the contract-specific set-aside classification.'});
  unique(hard.manufacturer_supplier_restrictions).forEach(requirement=>items.push({code:'MANUFACTURER_SUPPLIER_RESTRICTION',requirement,status:'UNVERIFIED',reason:'Manufacturer, authorized-source, or supplier-role status requires affirmative evidence before qualification.'}));
  unique(hard.registration_requirements).forEach(requirement=>items.push({code:'REGISTRATION_REQUIREMENT',requirement,status:'UNVERIFIED',reason:'SAM active-registration discovery establishes a baseline only; contract-specific registration requirements still require verification.'}));
  unique(hard.mandatory_requirements).forEach(requirement=>items.push({code:'MANDATORY_REQUIREMENT',requirement,status:'UNVERIFIED',reason:'The requirement is mandatory and cannot be inferred from NAICS search-path evidence alone.'}));
  unique(hard.other).forEach(requirement=>items.push({code:'OTHER_HARD_CONSTRAINT',requirement,status:'UNVERIFIED',reason:'This contract-specific hard constraint requires operator evidence review.'}));
  const geographicRestrictions=unique(hard.geographic_restrictions);
  if(geographicRestrictions.length){const state=candidate.state||'',matched=containsStateRestriction(geographicRestrictions,state);items.push({code:'GEOGRAPHIC_RESTRICTION',requirement:geographicRestrictions.join('; '),status:matched?'SUPPORTED':'UNVERIFIED',reason:matched?`Candidate state ${state} appears in the stated geographic restriction evidence.`:'Candidate business location does not by itself prove compliance with the stated place-of-performance or geographic restriction.'});}
  return items;
}
function aoieLineage(){
  return {
    source_asset:'netlify/functions/lib/aoie-federal.js',
    engine_version:AOIE_ENGINE_VERSION,
    ontology_version:AOIE_ONTOLOGY_VERSION,
    scoring_version:AOIE_SCORING_VERSION,
    source_scoring_dimensions:Object.keys(AOIE_DEFAULT_WEIGHTS||{}),
    reused_architecture:['WEIGHTED_SIGNALS','HARD_DISQUALIFIERS','SEPARATE_CONFIDENCE','EXPLAINABLE_EVIDENCE'],
    adaptation:'Contractor qualification reverses the AOIE business-to-opportunity comparison direction. The electronics-specific ontology is not generalized beyond its validated domain; NGCC uses Contract DNA and SAM evidence as the domain-neutral feature layer.',
  };
}
function qualifyCandidate({ candidate = {}, contractDna = {}, businessSearchDna = {} } = {}) {
  const reasons=[], evidence=[], signals={}, paths=candidatePaths(candidate), strongest=strongestPath(candidate);
  signals.naics_path=strongest?pathScore(strongest):0;
  if(strongest){const label=strongest.source==='sam_assigned'?'SAM-assigned NAICS':strongest.source==='derived_primary'?'requirements-derived primary NAICS':'requirements-derived related NAICS';reasons.push(`Candidate was discovered through the ${label} search path (${strongest.naics_code}).`);evidence.push({type:'NAICS_SEARCH_PATH',source:strongest.source,value:strongest.naics_code,weight_awarded:signals.naics_path});}
  signals.multiple_search_paths=paths.length>1?WEIGHTS.multipleSearchPaths:0;
  if(signals.multiple_search_paths){reasons.push(`Candidate appeared through ${paths.length} independent approved NAICS search paths.`);evidence.push({type:'MULTI_PATH_CORROBORATION',value:paths.map(p=>p.naics_code),weight_awarded:signals.multiple_search_paths});}
  signals.active_sam_registration=WEIGHTS.activeSamRegistration;reasons.push('Candidate was returned by the active-registration SAM.gov Entity Management search.');evidence.push({type:'ACTIVE_SAM_REGISTRATION',source:'SAM.gov Entity Management',value:true,weight_awarded:signals.active_sam_registration});
  const hasUei=Boolean(clean(candidate.ueiSAM||candidate.uei)),hasCage=Boolean(clean(candidate.cageCode||candidate.cage_code));
  signals.identity=hasUei&&hasCage?WEIGHTS.ueiAndCage:0;
  if(signals.identity){reasons.push('Candidate has both UEI and CAGE identifiers in the SAM entity response.');evidence.push({type:'FEDERAL_IDENTITY',value:{uei:candidate.ueiSAM||candidate.uei,cage:candidate.cageCode||candidate.cage_code},weight_awarded:signals.identity});}
  const hard=contractDna.hard_constraints||{}, geographicRestrictions=unique(hard.geographic_restrictions);
  signals.geography=geographicRestrictions.length&&containsStateRestriction(geographicRestrictions,candidate.state)?WEIGHTS.geographyEvidence:0;
  if(signals.geography)reasons.push('Candidate location supplies supporting evidence for a stated geographic restriction.');
  const declaredClassifications=unique(candidate.business_classifications||candidate.certifications||candidate.set_asides);
  const requiredClassification=clean(contractDna.competition?.eligible_business_classification||contractDna.competition?.set_aside||businessSearchDna.hard_requirements?.required_business_classification);
  const classificationSupported=requiredClassification&&declaredClassifications.some(value=>upper(value).includes(upper(requiredClassification))||upper(requiredClassification).includes(upper(value)));
  signals.business_classification=classificationSupported?WEIGHTS.businessClassificationEvidence:0;
  if(classificationSupported)reasons.push('Candidate-provided classification evidence appears compatible with the contract competition requirement.');
  const verification=verificationItems(contractDna,businessSearchDna,candidate),unresolved=verification.filter(item=>item.status==='UNVERIFIED'),explicitMismatch=verification.filter(item=>item.status==='MISMATCH');
  const score=explicitMismatch.length?0:Math.min(100,Object.values(signals).reduce((sum,value)=>sum+Number(value||0),0));
  let qualificationStatus;
  if(explicitMismatch.length)qualificationStatus='DISQUALIFIED';else if(unresolved.length)qualificationStatus='REVIEW_REQUIRED';else if(score>=QUALIFIED_THRESHOLD)qualificationStatus='QUALIFIED';else qualificationStatus='REVIEW_REQUIRED';
  const confidence=paths.length>1&&hasUei&&hasCage?'HIGH':paths.length&&hasUei?'MODERATE':'LOW';
  return {qualification_version:QUALIFICATION_VERSION,aoie_lineage:aoieLineage(),candidate_number:candidate.candidate_number||null,uei:candidate.ueiSAM||candidate.uei||null,cage_code:candidate.cageCode||candidate.cage_code||null,business_name:candidate.businessName||candidate.business_name||null,city:candidate.city||null,state:candidate.state||null,qualification_score:score,qualification_status:qualificationStatus,confidence,signal_scores:signals,matched_search_paths:paths,explanation:{why_ranked:reasons,verification_required:verification,evidence},operator_disposition:'PENDING'};
}
function rankCandidates({candidates=[],contractDna={},businessSearchDna={}}={}){return(Array.isArray(candidates)?candidates:[]).map(candidate=>qualifyCandidate({candidate,contractDna,businessSearchDna})).sort((a,b)=>b.qualification_score-a.qualification_score||a.business_name.localeCompare(b.business_name)).map((candidate,index)=>({rank:index+1,...candidate}));}
function qualificationSummary(ranked=[]){const counts={QUALIFIED:0,REVIEW_REQUIRED:0,DISQUALIFIED:0};ranked.forEach(item=>{counts[item.qualification_status]=(counts[item.qualification_status]||0)+1;});return{total:ranked.length,qualified:counts.QUALIFIED||0,review_required:counts.REVIEW_REQUIRED||0,disqualified:counts.DISQUALIFIED||0,top_score:ranked[0]?.qualification_score??null};}
module.exports={QUALIFICATION_VERSION,WEIGHTS,QUALIFIED_THRESHOLD,aoieLineage,qualifyCandidate,rankCandidates,qualificationSummary};
