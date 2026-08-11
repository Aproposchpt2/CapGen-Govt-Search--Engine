'use strict';

const assert = require('node:assert/strict');
const {
  buildContractDna,
  buildBusinessSearchDna,
  buildNaicsSearchPaths,
} = require('../netlify/functions/lib/ngcc-procurement-dna');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('preserves SAM NAICS when derivation disagrees', () => {
  const dna = buildContractDna({
    opportunity: { noticeId: 'N-1', title: 'Systems Integration', naicsCode: '541512' },
    derivation: {
      primary_naics: '541519',
      additional_naics: ['541511', '518210'],
      confirms_sam_code: false,
      rationale: 'Requirements emphasize systems integration and managed infrastructure.',
      description_used: true,
    },
  });

  assert.equal(dna.classification.sam_assigned_naics, '541512');
  assert.equal(dna.classification.derived_primary_naics, '541519');
  assert.deepEqual(dna.classification.derived_related_naics, ['541511', '518210']);
  assert.equal(dna.classification.sam_naics_confirmed, false);
  assert.deepEqual(dna.classification.naics_search_paths.map(p => [p.naics_code, p.source]), [
    ['541512', 'sam_assigned'],
    ['541519', 'derived_primary'],
    ['541511', 'derived_related'],
    ['518210', 'derived_related'],
  ]);
});

test('deduplicates a derived NAICS that confirms SAM', () => {
  const paths = buildNaicsSearchPaths({
    samAssignedNaics: '541512',
    derivedPrimaryNaics: '541512',
    derivedRelatedNaics: ['541512', '541519'],
  });
  assert.deepEqual(paths, [
    { naics_code: '541512', source: 'sam_assigned', priority: 1 },
    { naics_code: '541519', source: 'derived_related', priority: 3 },
  ]);
});

test('falls back to SAM-only search when derivation is unavailable', () => {
  const dna = buildContractDna({
    opportunity: { noticeId: 'N-2', title: 'Janitorial Services', naicsCode: '561720' },
  });
  const search = buildBusinessSearchDna(dna);
  assert.equal(dna.search_readiness, 'READY');
  assert.deepEqual(search.retrieval.search_naics, ['561720']);
  assert.equal(search.retrieval.naics_search_paths[0].source, 'sam_assigned');
});

test('Business Search DNA preserves search-path attribution and hard constraints', () => {
  const dna = buildContractDna({
    opportunity: {
      noticeId: 'N-3', title: 'Precision Components', naicsCode: '332710', setAside: 'Total Small Business Set-Aside'
    },
    derivation: { primary_naics: '332710', additional_naics: ['332721'], confirms_sam_code: true },
    requirements: {
      required_capabilities: ['CNC machining', 'precision inspection'],
      supplier_role: 'Manufacturer',
      psc: '5340',
      manufacturer_supplier_restrictions: ['Offeror must be the manufacturer or an approved source'],
      mandatory_requirements: ['Meet drawing tolerances'],
    },
  });
  const search = buildBusinessSearchDna(dna);
  assert.equal(search.hard_requirements.active_sam_registration, true);
  assert.equal(search.hard_requirements.set_aside_compatibility_required, true);
  assert.deepEqual(search.retrieval.search_naics, ['332710', '332721']);
  assert.equal(search.retrieval.supplier_role, 'Manufacturer');
  assert.equal(search.retrieval.psc, '5340');
  assert.deepEqual(search.qualification.manufacturer_supplier_restrictions, ['Offeror must be the manufacturer or an approved source']);
  assert.equal(search.output_contract.operator_review_required, true);
});

test('requires review when no search NAICS exists', () => {
  const dna = buildContractDna({ opportunity: { noticeId: 'N-4', title: 'Unclassified Requirement' } });
  const search = buildBusinessSearchDna(dna);
  assert.equal(dna.search_readiness, 'REVIEW_REQUIRED');
  assert.equal(search.search_readiness, 'REVIEW_REQUIRED');
});

console.log('NGCC procurement DNA validation passed.');
