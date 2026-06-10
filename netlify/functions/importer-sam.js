'use strict';

const TARGET_NAICS = ['541519', '541512', '541511', '541611', '561210'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAM_API_KEY  = process.env.SAM_API_KEY;

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function sbH() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  };
}

function fmtMDY(d) {
  // SAM.gov expects MM/DD/YYYY
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const y = d.getFullYear();
  return m + '/' + day + '/' + y;
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  // Guard: check required env vars
  if (!SAM_API_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ success: false, error: 'SAM_API_KEY not set in Netlify environment' }) };
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ success: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' }) };
  }

  try {
    // 1. Get all existing UEIs from Supabase to deduplicate
    const existingRes = await fetch(
      SUPABASE_URL + '/rest/v1/contractors?select=id&limit=10000',
      { headers: sbH() }
    );
    if (!existingRes.ok) {
      const err = await existingRes.text();
      throw new Error('Failed to fetch existing contractors: ' + err);
    }
    const existingRows = await existingRes.json();
    const existingUEIs = new Set(existingRows.map(function(r) { return r.id; }));
    console.log('[importer-sam] Existing contractors in DB:', existingUEIs.size);

    // 2. Build date range — last 30 days in MM/DD/YYYY format
    const now   = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    const fromDate = fmtMDY(start);
    const toDate   = fmtMDY(now);
    console.log('[importer-sam] Date range:', fromDate, '->', toDate);

    // 3. Fetch SAM.gov with pagination
    let page = 0;
    let samTotalFetched = 0;
    const matchedEntities = [];
    const seenInBatch = new Set();

    while (page < 20) {  // cap at 20 pages (2000 records) to stay under timeout
      // v2 API with exact params from SAM.gov docs (note typo 'registerationDateRange' is correct)
      const fmtYMD = function(d){ return d.toISOString().slice(0,10); };
      const now2 = new Date();
      const start2 = new Date(now2); start2.setDate(start2.getDate()-30);
      const params = new URLSearchParams({
        api_key: SAM_API_KEY,
        'registrationDateRange.from': fmtYMD(start2),
        'registrationDateRange.to':   fmtYMD(now2),
        entityStatus: 'Active',
        includeSections: 'entityRegistration,coreData,assertions',
        page: String(page),
        size: '100'
      });

      const samUrl = 'https://api.sam.gov/entity-information/v3/entities?' + params.toString();
      console.log('[importer-sam] Fetching page', page);

      let samRes;
      try {
        samRes = await fetch(samUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      } catch (fetchErr) {
        console.error('[importer-sam] SAM.gov fetch error on page', page, ':', fetchErr.message);
        break;
      }

      if (!samRes.ok) {
        const errText = await samRes.text();
        console.error('[importer-sam] SAM API HTTP error', samRes.status, ':', errText.slice(0, 200));
        // Don't throw — just stop paginating and return what we have
        break;
      }

      let samData;
      try {
        samData = await samRes.json();
      } catch(e) {
        console.error('[importer-sam] Failed to parse SAM response:', e.message);
        break;
      }

      const entities = samData.entityData || [];
      samTotalFetched += entities.length;
      console.log('[importer-sam] Page', page, ': fetched', entities.length, 'entities');

      if (entities.length === 0) break;

      for (const entity of entities) {
        const reg  = (entity.entityRegistration || {});
        const core = (entity.coreData || {});
        const assertions = (entity.assertions || {});
        const uei  = reg.ueiSAM;
        if (!uei) continue;

        // Dedup against DB and within batch
        if (existingUEIs.has(uei) || seenInBatch.has(uei)) continue;

        // Filter: small business
        const sbaTypes = (core.businessTypes && core.businessTypes.sbaBusinessTypeList) || [];
        const isSmall  = sbaTypes.length > 0 ||
          (assertions.goodsAndServices && assertions.goodsAndServices.naicsList || []).some(function(n) { return n.sbaSmallBusiness === 'Y'; });

        // Filter: NAICS
        const naicsList = (assertions.goodsAndServices && assertions.goodsAndServices.naicsList) || [];
        const primaryNaics = (assertions.goodsAndServices && assertions.goodsAndServices.primaryNaics) || '';
        const allNaics = naicsList.map(function(n) { return n.naicsCode; });
        const hasTargetNaics = allNaics.some(function(c) { return TARGET_NAICS.includes(c); }) ||
                                TARGET_NAICS.includes(primaryNaics);

        if (!hasTargetNaics) continue;

        seenInBatch.add(uei);
        const addr = (core.physicalAddress || {});
        matchedEntities.push({
          id:                uei,
          legal_name:        reg.legalBusinessName || '',
          doing_business_as: reg.dbaName || null,
          address_street:    addr.addressLine1 || null,
          address_city:      addr.city || null,
          address_state:     addr.stateOrProvinceCode || null,
          address_zip:       addr.zipCode || null,
          naics_codes:       allNaics,
          primary_naics:     primaryNaics || null,
          business_type:     isSmall ? 'Small Business' : 'Business',
          sam_status:        reg.registrationStatus === 'A' ? 'Active' : (reg.registrationStatus || 'Unknown'),
          registration_date: reg.registrationDate || null,
          website_url:       core.entityURL || null,
          imported_at:       new Date().toISOString(),
          enrichment_status: 'pending',
          outreach_status:   'pending'
        });
      }

      // Check if there are more pages
      const totalRecords = samData.totalRecords || 0;
      if (samTotalFetched >= totalRecords || entities.length < 100) break;
      page++;
    }

    console.log('[importer-sam] Total SAM fetched:', samTotalFetched, '| Matched:', matchedEntities.length);

    // 4. Upsert matched contractors to Supabase in chunks of 50
    let inserted = 0;
    let errors   = 0;
    const CHUNK  = 50;

    for (let i = 0; i < matchedEntities.length; i += CHUNK) {
      const chunk = matchedEntities.slice(i, i + CHUNK);
      const upsertRes = await fetch(SUPABASE_URL + '/rest/v1/contractors', {
        method: 'POST',
        headers: Object.assign({}, sbH(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(chunk)
      });
      if (upsertRes.ok) {
        inserted += chunk.length;
      } else {
        const errText = await upsertRes.text();
        console.error('[importer-sam] Upsert error for chunk', i, ':', errText.slice(0, 200));
        errors += chunk.length;
      }
    }

    console.log('[importer-sam] Done. Inserted:', inserted, '| Errors:', errors);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        success: true,
        samTotalFetched,
        matchedFilters:       matchedEntities.length,
        dedupedUnique:        matchedEntities.length,
        contractorsImported:  inserted,
        contractorsSkipped:   errors,
        alreadyInDatabase:    samTotalFetched - matchedEntities.length,
        dateRange: { from: fromDate, to: toDate }
      })
    };

  } catch (err) {
    console.error('[importer-sam] Fatal error:', err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
