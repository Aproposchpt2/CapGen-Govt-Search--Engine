'use strict';

const assert = require('assert');
const {
  detectConcepts,
  expandBusinessProfile,
  scoreMatch,
} = require('../netlify/functions/lib/aoie-federal');

const wholesaleAutomation = {
  legal_name: 'Wholesale Automation and Controls LLC',
  primary_naics: '423610',
  naics: [
    '238210', '333242', '334290', '334413', '334418', '334419',
    '335314', '423430', '423610', '423690', '541512', '541519'
  ],
  set_asides: ['Small Business'],
  state: 'CA',
};

const profile = expandBusinessProfile(wholesaleAutomation);

function test(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name);
    throw error;
  }
}

test('cross-NAICS semiconductor opportunity is a strong match', () => {
  const result = scoreMatch(profile, {
    solicitation_number: 'SPE7M526Q0729',
    title: '59--SEMICONDUCTOR DEVIC',
    agency: 'Defense Logistics Agency DLA Land and Maritime',
    naics_code: '334413',
    response_deadline: '2099-07-20',
  });
  assert.ok(result.fit_score >= 85, JSON.stringify(result));
  assert.strictEqual(result.match_status, 'Strong Match');
  assert.ok(result.explanation.why_matched.some((line) => /distributor|wholesaler/i.test(line)));
});

test('brush chipper is not interpreted as a semiconductor', () => {
  const concepts = detectConcepts('BRUSH CHIPPER Sources Sought Brand Name or Equal');
  assert.strictEqual(concepts.length, 0);
});

test('ASIC opportunity is retrieved as semiconductor concept', () => {
  const result = scoreMatch(profile, {
    title: 'Application Specific Integrated Circuit ASIC',
    agency: 'Naval Air Systems Command',
    naics_code: '334511',
    response_deadline: '2099-08-01',
  });
  assert.ok(result.fit_score >= 70, JSON.stringify(result));
  assert.ok(result.explanation.concept_evidence.some((item) => item.id === 'semiconductor_device'));
});

test('semiconductor process pump is not over-scored as chip supply', () => {
  const result = scoreMatch(profile, {
    title: 'Two semiconductor-process compatible dry pumps',
    description: 'Vacuum pumps for process equipment',
    agency: 'NASA',
    naics_code: '334516',
    response_deadline: '2099-07-20',
  });
  assert.ok(result.fit_score < 85, JSON.stringify(result));
});

test('unrelated janitorial opportunity is not recommended', () => {
  const result = scoreMatch(profile, {
    title: 'Janitorial and custodial services',
    agency: 'General Services Administration',
    naics_code: '561720',
    response_deadline: '2099-08-01',
  });
  assert.strictEqual(result.match_status, 'Not Recommended');
});

test('expired opportunity is hard-disqualified', () => {
  const result = scoreMatch(profile, {
    title: 'Semiconductor device',
    agency: 'DLA',
    naics_code: '334413',
    response_deadline: '2020-01-01',
  });
  assert.strictEqual(result.hard_disqualifier, 'EXPIRED');
  assert.strictEqual(result.fit_score, 0);
});

test('manufacturer-only requirement blocks distributor-only profile', () => {
  const distributorProfile = expandBusinessProfile({
    legal_name: 'Distributor Only LLC',
    primary_naics: '423690',
    naics: ['423690'],
  });
  const result = scoreMatch(distributorProfile, {
    title: 'Semiconductor device manufacturer only',
    description: 'Original equipment manufacturer only; distributors not accepted.',
    agency: 'DLA',
    naics_code: '334413',
    response_deadline: '2099-08-01',
  });
  assert.strictEqual(result.hard_disqualifier, 'MANUFACTURER_ONLY_MISMATCH');
});

console.log('AOIE federal matcher fixture suite complete.');
