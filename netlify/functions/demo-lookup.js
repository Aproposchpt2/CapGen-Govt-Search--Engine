'use strict';
// demo-lookup.js — Federal entity disambiguation for NGCC intake
// GET/POST { businessName, state?, cage?, uei? } → up to 5 candidates

const SAM_API_KEY  = process.env.SAM_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAM_ENTITY   = 'https://api.sam.gov/entity-information/v3/entities';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function normalizeBusinessName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|LLC|L L C)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapCandidates(data) {
  return (data.entityData || []).map(function(e) {
    var reg  = e.entityRegistration || {};
    var core = e.coreData || {};
    var addr = core.physicalAddress || {};
    var registered = String(reg.samRegistered || '').toLowerCase() === 'yes';
    return {
      uei: reg.ueiSAM,
      legal_name: reg.legalBusinessName || '',
      city: addr.city || null,
      state: addr.stateOrProvinceCode || null,
      address_line_1: addr.addressLine1 || null,
      zip: addr.zipCode || null,
      sam_registered: registered,
      registration_status: reg.registrationStatus === 'A' ? 'Active' : (reg.registrationStatus || (registered ? 'Registered' : 'ID Assigned')),
      registration_status_code: reg.registrationStatus || null,
      registration_expiration_date: reg.registrationExpirationDate || reg.expirationDate || null,
      uei_status: reg.ueiStatus || null,
      cage: reg.cageCode || null,
    };
  }).filter(function(c) { return !!c.uei; });
}

async function querySam(paramsObj) {
  var params = new URLSearchParams(Object.assign({
    api_key: SAM_API_KEY,
    includeSections: 'entityRegistration,coreData',
  }, paramsObj));
  var samRes = await fetch(SAM_ENTITY + '?' + params.toString(), { headers: { Accept: 'application/json' } });
  if (!samRes.ok) throw new Error('Registry ' + samRes.status + ': ' + (await samRes.text()).slice(0, 200));
  return mapCandidates(await samRes.json());
}

function uniqueCandidates(rows) {
  var seen = new Set();
  return rows.filter(function(row) {
    var key = row.uei || row.cage || row.legal_name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function lookupBothRegistrationClasses(filter) {
  var registered = await querySam(Object.assign({ samRegistered: 'Yes' }, filter));
  var idAssigned = await querySam(Object.assign({ samRegistered: 'No' }, filter));
  return uniqueCandidates(registered.concat(idAssigned));
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET or POST only' }) };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown';
  const since = new Date(Date.now() - 3600000).toISOString();
  try {
    var rr = await fetch(
      SUPABASE_URL + '/rest/v1/demo_snapshots?requester_ip=eq.' + encodeURIComponent(ip)
        + '&created_at=gte.' + encodeURIComponent(since) + '&select=id',
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
    );
    if (rr.ok && (await rr.json()).length >= 10) {
      return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'RATE_LIMIT', message: 'Too many requests. Please try again in an hour.' }) };
    }
  } catch(e) { /* non-fatal */ }

  var body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); }
    catch(e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  } else {
    body = event.queryStringParameters || {};
  }

  var businessName = (body.businessName || '').trim();
  var state = (body.state || '').trim().toUpperCase().slice(0, 2) || null;
  var cage = (body.cage || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || null;
  var uei = (body.uei || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || null;

  if (!businessName && !cage && !uei) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Business name, CAGE code, or UEI required' }) };
  if (!SAM_API_KEY) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Configuration error' }) };

  try {
    var all = [];

    if (uei) all = await lookupBothRegistrationClasses({ ueiSAM: uei });
    if (!all.length && cage) all = await lookupBothRegistrationClasses({ cageCode: cage });

    if (!all.length && businessName) {
      all = await querySam({ legalBusinessName: businessName, samRegistered: 'Yes', registrationStatus: 'A' });
    }
    if (!all.length && businessName) {
      all = await lookupBothRegistrationClasses({ legalBusinessName: businessName });
    }
    if (!all.length && businessName) {
      var normalized = normalizeBusinessName(businessName);
      var broadName = businessName.replace(/[,\.]/g, ' ').replace(/\s+/g, ' ').trim();
      var broad = await lookupBothRegistrationClasses({ legalBusinessName: broadName });
      all = broad.filter(function(c) {
        var n = normalizeBusinessName(c.legal_name);
        return n === normalized || n.includes(normalized) || normalized.includes(n);
      });
    }

    var candidates = state
      ? all.filter(function(c) { return !c.state || c.state.toUpperCase() === state; }).concat(
          all.filter(function(c) { return c.state && c.state.toUpperCase() !== state; })
        )
      : all;

    if (uei) candidates.sort(function(a, b) {
      return (String(b.uei || '').toUpperCase() === uei) - (String(a.uei || '').toUpperCase() === uei);
    });
    if (cage) candidates.sort(function(a, b) {
      return (String(b.cage || '').toUpperCase() === cage) - (String(a.cage || '').toUpperCase() === cage);
    });

    candidates = uniqueCandidates(candidates).slice(0, 5);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ total: candidates.length, candidates: candidates }) };
  } catch(err) {
    console.error('[demo-lookup]', err.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Lookup failed', detail: err.message }) };
  }
};