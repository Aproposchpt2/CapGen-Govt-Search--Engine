// NGCC ops — SAM.gov registered-contractor search by NAICS code.
// This is the "one source for both entities" piece: the same SAM.gov
// Entity Management API this repo already uses in bulk
// (import-active-contractors.js), here used as a live, on-demand reverse
// search (NAICS code -> every active registered entity in that code) to
// build the candidate contractor list for ONE contract found via
// sam-lookup.js / SAM.gov Opportunities. Public tier only — no contact
// email (see lib/ngcc-ops.js header comment for why).
'use strict';
const { json, opsGuard, samEntitySearchByNaics } = require('./lib/ngcc-ops');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request body.' }); }
  const naicsCode = String(body.naicsCode || '').trim();
  const state = String(body.state || '').trim().toUpperCase();
  const limit = Math.min(Number(body.limit) || 500, 500);
  if (!naicsCode) return json(400, { ok: false, error: 'naicsCode is required.' });

  try {
    const { entities, totalRecords } = await samEntitySearchByNaics({ naicsCode, state: state || undefined, limit });
    return json(200, { ok: true, naicsCode, state: state || null, count: entities.length, total_records: totalRecords, truncated: totalRecords > entities.length, entities });
  } catch (error) {
    console.error('[ngcc-sam-entity-search]', error.message);
    return json(200, { ok: false, error: error.message });
  }
};
