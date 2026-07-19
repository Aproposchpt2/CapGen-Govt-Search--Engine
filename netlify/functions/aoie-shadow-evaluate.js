'use strict';

const {
  ENGINE_VERSION,
  ONTOLOGY_VERSION,
  SCORING_VERSION,
  expandBusinessProfile,
  scoreMatch,
} = require('./lib/aoie-federal');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_TOKEN = process.env.AOIE_INTERNAL_TOKEN;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
}

async function queryCandidates(profile) {
  const naics = (profile.exact_naics || []).slice(0, 20);
  const queries = [];

  if (naics.length) {
    queries.push(
      SUPABASE_URL + '/rest/v1/sam_opportunities?naics_code=in.(' + naics.map(encodeURIComponent).join(',') + ')' +
      '&select=notice_id,title,solicitation_number,agency,naics_code,set_aside,response_deadline,ui_link,raw&limit=200'
    );
  }

  const semanticTerms = ['semiconductor', 'integrated circuit', 'microelectronics', 'ASIC', 'electronic component'];
  semanticTerms.forEach((term) => {
    queries.push(
      SUPABASE_URL + '/rest/v1/sam_opportunities?or=(title.ilike.*' + encodeURIComponent(term) + '*,raw::text.ilike.*' + encodeURIComponent(term) + '*)' +
      '&select=notice_id,title,solicitation_number,agency,naics_code,set_aside,response_deadline,ui_link,raw&limit=100'
    );
  });

  const results = await Promise.all(queries.map(async (url) => {
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error('Candidate query failed: ' + res.status + ' ' + await res.text());
    return res.json();
  }));

  const byNotice = new Map();
  results.flat().forEach((row) => {
    const key = row.notice_id || row.solicitation_number || row.ui_link;
    if (key && !byNotice.has(key)) byNotice.set(key, row);
  });
  return Array.from(byNotice.values());
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  if (!INTERNAL_TOKEN || event.headers['x-aoie-token'] !== INTERNAL_TOKEN) return response(401, { error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return response(500, { error: 'AOIE database configuration missing' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return response(400, { error: 'Invalid JSON' });
  }

  const business = payload.profile || {};
  if (!business.legal_name || !(business.naics || business.naics_codes || []).length) {
    return response(400, { error: 'profile.legal_name and profile.naics are required' });
  }

  try {
    const capabilityProfile = expandBusinessProfile(business);
    const candidates = await queryCandidates(capabilityProfile);
    const scored = candidates
      .map((opportunity) => {
        const raw = opportunity.raw || {};
        const enriched = Object.assign({}, opportunity, {
          description: raw.description || raw.fullParentPathName || raw.additionalInfoLink || '',
          psc: raw.classificationCode || raw.productServiceCode || null,
        });
        return Object.assign({}, opportunity, { aoie: scoreMatch(capabilityProfile, enriched) });
      })
      .filter((row) => row.aoie.match_status !== 'Not Recommended')
      .sort((a, b) => b.aoie.fit_score - a.aoie.fit_score)
      .slice(0, 100);

    return response(200, {
      mode: 'shadow',
      engine_version: ENGINE_VERSION,
      ontology_version: ONTOLOGY_VERSION,
      scoring_version: SCORING_VERSION,
      profile: capabilityProfile,
      candidate_count: candidates.length,
      result_count: scored.length,
      results: scored,
    });
  } catch (error) {
    console.error('[aoie-shadow-evaluate]', error);
    return response(500, { error: 'AOIE shadow evaluation failed', detail: error.message });
  }
};
