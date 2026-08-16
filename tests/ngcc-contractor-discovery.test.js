'use strict';

const assert = require('node:assert/strict');
const { mergeDiscoveryBatch, finalizeCandidates } = require('../netlify/functions/lib/ngcc-contractor-discovery');

const map = new Map();
mergeDiscoveryBatch(map, [
  { ueiSAM: 'UEI001', businessName: 'Alpha LLC', state: 'NV' },
  { ueiSAM: 'UEI002', businessName: 'Beta LLC', state: 'CA' },
], { naics_code: '541512', source: 'sam_assigned', priority: 1 }, 20);
mergeDiscoveryBatch(map, [
  { ueiSAM: 'UEI001', businessName: 'Alpha LLC', state: 'NV' },
  { ueiSAM: 'UEI003', businessName: 'Gamma LLC', state: 'AZ' },
], { naics_code: '541519', source: 'derived_primary', priority: 2 }, 20);

const candidates = finalizeCandidates(map);
assert.equal(candidates.length, 3);
assert.deepEqual(candidates.map(c => c.candidate_number), [1, 2, 3]);
const alpha = candidates.find(c => c.ueiSAM === 'UEI001');
assert.equal(alpha.matched_search_paths.length, 2);
assert.equal(alpha.primary_search_path.source, 'sam_assigned');
assert.equal(alpha.qualification_status, 'PENDING');
assert.equal(alpha.operator_disposition, 'PENDING');

const capped = new Map();
mergeDiscoveryBatch(capped, [
  { ueiSAM: 'A', businessName: 'A' },
  { ueiSAM: 'B', businessName: 'B' },
  { ueiSAM: 'C', businessName: 'C' },
], { naics_code: '561720', source: 'sam_assigned', priority: 1 }, 2);
assert.equal(capped.size, 2);

console.log('NGCC contractor discovery validation passed.');
