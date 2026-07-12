'use strict';

const SAM_ENTITY_URL = 'https://api.sam.gov/entity-information/v3/entities';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES_PER_RUN = 10;
const TARGET_TABLE = process.env.ACTIVE_CONTRACTORS_TABLE || 'sam_active_contractors';

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Import-Secret, X-Admin-Key'
};

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

function firstNonEmpty(values) {
  for (var i = 0; i < values.length; i += 1) {
    var value = values[i];
    if (value === undefined || value === null) continue;
    var text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function dedupeStrings(values) {
  var seen = new Set();
  var output = [];

  (Array.isArray(values) ? values : []).forEach(function(value) {
    var text = String(value || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });

  return output;
}

function pickDate(value) {
  if (!value) return null;
  var text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function readArray(list, keys) {
  if (!Array.isArray(list)) return [];

  return dedupeStrings(
    list.map(function(item) {
      if (!item || typeof item !== 'object') return null;
      return firstNonEmpty(keys.map(function(key) { return item[key]; }));
    })
  );
}

function mapNaics(naicsList) {
  if (!Array.isArray(naicsList)) return { codes: [], details: [] };

  var details = naicsList
    .map(function(item) {
      if (!item || typeof item !== 'object') return null;
      var code = firstNonEmpty([item.naicsCode, item.code]);
      var description = firstNonEmpty([item.naicsDescription, item.description]);
      if (!code && !description) return null;
      return { code: code, description: description };
    })
    .filter(Boolean);

  return {
    codes: dedupeStrings(details.map(function(item) { return item.code; })),
    details: details
  };
}

function mapEntity(entity) {
  var coreData = entity.coreData || {};
  var entityInformation = coreData.entityInformation || {};
  var generalInformation = coreData.generalInformation || {};
  var physicalAddress = generalInformation.physicalAddress || entityInformation.physicalAddress || {};
  var registration = entity.entityRegistration || {};
  var assertions = entity.assertions || {};
  var businessTypes = coreData.businessTypes || assertions.businessTypes || {};
  var naics = mapNaics((assertions.goodsAndServices && assertions.goodsAndServices.naicsList) || assertions.naicsList || []);

  var certificationValues = []
    .concat(readArray(assertions.sbaBusinessTypes && assertions.sbaBusinessTypes.sbaBusinessTypeList, ['businessTypeDesc', 'description', 'businessType']))
    .concat(
      readArray(
        assertions.financialInformation && assertions.financialInformation.acceptsGovernmentPurchaseCards
          ? [{ value: 'Accepts Government Purchase Cards' }]
          : [],
        ['value']
      )
    );

  var businessTypeValues = []
    .concat(readArray(businessTypes.businessTypeList, ['businessTypeDesc', 'description', 'businessType']))
    .concat(readArray(businessTypes.organizationFactors && businessTypes.organizationFactors.organizationFactorList, ['organizationFactorDesc', 'description']));

  var legalName = firstNonEmpty([
    entityInformation.legalBusinessName,
    coreData.entityName,
    entity.legalBusinessName
  ]);

  return {
    uei: firstNonEmpty([
      registration.ueiSAM,
      entityInformation.ueiSAM,
      entity.ueiSAM,
      entity.uei
    ]),
    legal_name: legalName,
    cage_code: firstNonEmpty([
      entityInformation.cageCode,
      coreData.cageCode,
      entity.cageCode
    ]),
    registration_status: firstNonEmpty([
      registration.registrationStatus,
      entity.registrationStatus,
      'Active'
    ]),
    activation_date: pickDate(firstNonEmpty([registration.activationDate, registration.registrationDate])),
    expiration_date: pickDate(registration.expirationDate),
    entity_structure: firstNonEmpty([
      generalInformation.entityStructureDesc,
      generalInformation.entityStructure,
      entityInformation.entityStructureDesc
    ]),
    website: firstNonEmpty([
      generalInformation.entityUrl,
      generalInformation.website,
      entityInformation.entityUrl
    ]),
    city: firstNonEmpty([physicalAddress.city, physicalAddress.cityName]),
    state: firstNonEmpty([
      physicalAddress.stateOrProvinceCode,
      physicalAddress.stateOrProvinceName,
      physicalAddress.state
    ]),
    zip_code: firstNonEmpty([
      physicalAddress.zipCodePlus4,
      physicalAddress.zipCode
    ]),
    country_code: firstNonEmpty([
      physicalAddress.countryCode,
      physicalAddress.countryName
    ]),
    naics_codes: naics.codes,
    naics_details: naics.details,
    certifications: dedupeStrings(certificationValues),
    business_types: dedupeStrings(businessTypeValues),
    has_exclusions: Boolean(entity.exclusionRecord && entity.exclusionRecord.hasActiveExclusion),
    source_payload: entity
  };
}

function getTargetSupabaseConfig() {
  return {
    url: firstNonEmpty([
      process.env.MARKETPLACE_SUPABASE_URL,
      process.env.CONTRACTACCESS_SUPABASE_URL,
      process.env.SUPABASE_URL
    ]),
    key: firstNonEmpty([
      process.env.MARKETPLACE_SUPABASE_SERVICE_ROLE_KEY,
      process.env.CONTRACTACCESS_SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPABASE_SERVICE_KEY,
      process.env.SUPABASE_KEY
    ])
  };
}

function buildSupabaseUrl(baseUrl, tableName) {
  return String(baseUrl || '').replace(/\/+$/, '') + '/rest/v1/' + tableName;
}

async function upsertBatch(records, supabaseUrl, serviceRoleKey) {
  var response = await fetch(buildSupabaseUrl(supabaseUrl, TARGET_TABLE) + '?on_conflict=uei', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: 'Bearer ' + serviceRoleKey,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(records)
  });

  if (!response.ok) {
    throw new Error('Supabase upsert failed: ' + response.status + ' ' + await response.text());
  }
}

async function fetchSamPage(samApiKey, start, length) {
  var samUrl = new URL(SAM_ENTITY_URL);
  samUrl.searchParams.set('api_key', samApiKey);
  samUrl.searchParams.set('registrationStatus', 'A');
  samUrl.searchParams.set('start', String(start));
  samUrl.searchParams.set('length', String(length));
  samUrl.searchParams.set('includeSections', 'entityRegistration,coreData,assertions');

  var response = await fetch(samUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error('SAM.gov request failed: ' + response.status + ' ' + await response.text());
  }

  return response.json();
}

function readSecret(event, body) {
  var headers = event.headers || {};
  return firstNonEmpty([
    headers['x-import-secret'],
    headers['X-Import-Secret'],
    headers['x-admin-key'],
    headers['X-Admin-Key'],
    body && body.secret
  ]);
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed. Use POST.' });
  }

  var body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      return json(400, { error: 'Request body must be valid JSON.' });
    }
  }

  var expectedSecret = firstNonEmpty([
    process.env.SAM_IMPORT_SECRET,
    process.env.BC_VERIFY_SECRET
  ]);
  if (!expectedSecret) {
    return json(500, { error: 'Missing SAM_IMPORT_SECRET or BC_VERIFY_SECRET environment variable.' });
  }

  if (readSecret(event, body) !== expectedSecret) {
    return json(401, { error: 'Unauthorized.' });
  }

  var samApiKey = process.env.SAM_API_KEY;
  var targetSupabase = getTargetSupabaseConfig();
  if (!samApiKey) {
    return json(500, { error: 'Missing SAM_API_KEY environment variable.' });
  }
  if (!targetSupabase.url || !targetSupabase.key) {
    return json(500, {
      error: 'Missing target Supabase credentials. Set MARKETPLACE_SUPABASE_URL and MARKETPLACE_SUPABASE_SERVICE_ROLE_KEY, or reuse the default SUPABASE_* values.'
    });
  }

  var start = Math.max(0, Number.parseInt(body.start, 10) || 0);
  var length = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(body.length, 10) || DEFAULT_PAGE_SIZE));
  var maxPages = Math.min(MAX_PAGES_PER_RUN, Math.max(1, Number.parseInt(body.maxPages, 10) || DEFAULT_MAX_PAGES));

  var currentStart = start;
  var totalImported = 0;
  var totalSkipped = 0;
  var pagesProcessed = 0;
  var totalRecords = null;

  try {
    while (pagesProcessed < maxPages) {
      var payload = await fetchSamPage(samApiKey, currentStart, length);
      var entities = Array.isArray(payload.entityData)
        ? payload.entityData
        : Array.isArray(payload.entities)
          ? payload.entities
          : [];

      if (totalRecords === null) {
        totalRecords = payload.totalRecords || payload.totalrecords || null;
      }

      var records = entities.map(mapEntity).filter(function(record) {
        return record.uei && record.legal_name;
      });

      totalSkipped += Math.max(0, entities.length - records.length);

      if (records.length) {
        await upsertBatch(records, targetSupabase.url, targetSupabase.key);
        totalImported += records.length;
      }

      pagesProcessed += 1;
      currentStart += length;

      if (!entities.length || entities.length < length) break;
      if (totalRecords !== null && currentStart >= totalRecords) break;
    }
  } catch (error) {
    return json(502, {
      error: 'Active contractor import failed.',
      details: error.message,
      imported: totalImported,
      skipped: totalSkipped,
      pagesProcessed: pagesProcessed,
      nextStart: currentStart,
      totalRecords: totalRecords,
      targetTable: TARGET_TABLE
    });
  }

  return json(200, {
    imported: totalImported,
    skipped: totalSkipped,
    requestedPerPage: length,
    maxPages: maxPages,
    pagesProcessed: pagesProcessed,
    start: start,
    nextStart: currentStart,
    totalRecords: totalRecords,
    completed: totalRecords !== null ? currentStart >= totalRecords : false,
    targetTable: TARGET_TABLE
  });
};
