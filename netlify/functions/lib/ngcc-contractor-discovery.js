'use strict';

function candidateKey(entity = {}) {
  return String(entity.ueiSAM || entity.uei || '').trim() || `${String(entity.businessName || '').trim()}|${String(entity.state || '').trim()}`;
}

function mergeCandidate(existing, entity, path) {
  const matched = Array.isArray(existing?.matched_search_paths) ? [...existing.matched_search_paths] : [];
  if (path && !matched.some(item => item.naics_code === path.naics_code && item.source === path.source)) {
    matched.push({ naics_code: path.naics_code, source: path.source, priority: path.priority });
  }
  return {
    ...(existing || {}),
    ...entity,
    matched_search_paths: matched,
    primary_search_path: existing?.primary_search_path || (path ? { naics_code: path.naics_code, source: path.source, priority: path.priority } : null),
  };
}

function mergeDiscoveryBatch(candidateMap, entities, path, cap) {
  const map = candidateMap instanceof Map ? candidateMap : new Map();
  for (const entity of Array.isArray(entities) ? entities : []) {
    const key = candidateKey(entity);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing && map.size >= cap) break;
    map.set(key, mergeCandidate(existing, entity, path));
  }
  return map;
}

function finalizeCandidates(candidateMap) {
  return [...candidateMap.values()].map((candidate, index) => ({
    candidate_number: index + 1,
    ...candidate,
    candidate_source: 'SAM.gov Entity Management',
    qualification_status: 'PENDING',
    operator_disposition: 'PENDING',
    contact_status: 'NOT_STARTED',
    outreach_status: 'NOT_STARTED',
  }));
}

module.exports = { candidateKey, mergeCandidate, mergeDiscoveryBatch, finalizeCandidates };
