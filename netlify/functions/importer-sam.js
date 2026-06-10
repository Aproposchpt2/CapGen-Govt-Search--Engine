'use strict';

const TARGET_NAICS = ['541519', '541512', '541511', '541611', '561210'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAM_API_KEY = process.env.SAM_API_KEY;

function sbH() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  };
}

exports.handler = async function (event, context) {
  try {
    // 1. Get all existing UEIs from Supabase
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/contractors?select=id`,
      { headers: sbH() }
    );
    if (!existingRes.ok) {
      const err = await existingRes.text();
      throw new Error(`Failed to fetch existing contractors: ${err}`);
    }
    const existingRows = await existingRes.json();
    const existingUEIs = new Set(existingRows.map(r => r.id));

    // 2. Determine date range (last 30 days)
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    const fmt = d => d.toISOString().slice(0, 10);
    const dateRange = `${fmt(start)}:${fmt(now)}`;

    // 3. Fetch SAM.gov API with pagination
    let page = 0;
    let samTotalFetched = 0;
    const matchedEntities = [];
    const seenInBatch = new Set();

    while (page < 50) {
      const params = new URLSearchParams({
        api_key: SAM_API_KEY,
        registrationDate: dateRange,
        registrationStatus: 'A',
        includeSections: 'entityRegistration,coreData,assertions',
        page: String(page),
        pageSize: '100'
      });

      const samRes = await fetch(
        `https://api.sam.gov/entity-information/v3/entities?${params.toString()}`
      );

      if (!samRes.ok) {
        const errText = await samRes.text();
        console.error(`SAM API error on page ${page}:`, errText);
        break;
      }

      const samData = await samRes.json();
      const entities = (samData.entityData || []);
      samTotalFetched += entities.length;

      if (entities.length === 0) break;

      for (const entity of entities) {
        const reg = entity.entityRegistration || {};
        const core = entity.coreData || {};
        const assertions = entity.assertions || {};

        const uei = reg.ueiSAM;
        if (!uei) continue;

        // Skip if already in DB
        if (existingUEIs.has(uei)) continue;

        // Skip if already seen in this batch
        if (seenInBatch.has(uei)) continue;

        // Check small business flag
        const sbaList = (core.businessInformation && core.businessInformation.sbaBusinessTypeList) || [];
        const isSmallBusiness = sbaList.some(sba =>
          sba.sbaBusinessTypeCode && sba.sbaBusinessTypeCode.toLowerCase().includes('2x')
          || (sba.sbaBusinessTypeDesc && sba.sbaBusinessTypeDesc.toLowerCase().includes('small'))
        );
        // Also accept if sbaBusinessTypeList exists and has entries (any SBA designation)
        if (sbaList.length === 0) {
          // Check via assertions
          const goodsServices = assertions.goodsAndServices || {};
          const naicsList = goodsServices.naicsList || [];
          if (naicsList.length === 0) continue;
        }

        // Check target NAICS
        const goodsServices = assertions.goodsAndServices || {};
        const naicsList = goodsServices.naicsList || [];
        const naicsCodes = naicsList.map(n => String(n.naicsCode));
        const hasTargetNaics = naicsCodes.some(code => TARGET_NAICS.includes(code));
        if (!hasTargetNaics) continue;

        seenInBatch.add(uei);

        const physAddr = (core.physicalAddress) || {};
        matchedEntities.push({
          id: uei,
          legal_name: reg.legalBusinessName || null,
          doing_business_as: reg.dbaName || null,
          address_street: physAddr.addressLine1 || null,
          address_city: physAddr.city || null,
          address_state: physAddr.stateOrProvinceCode || null,
          address_zip: physAddr.zipCode || null,
          naics_codes: naicsCodes,
          primary_naics: goodsServices.primaryNaics || null,
          business_type: sbaList.length > 0 ? (sbaList[0].sbaBusinessTypeDesc || 'small') : null,
          sam_status: reg.registrationStatus || 'A',
          registration_date: reg.registrationExpirationDate || null,
          website_url: null,
          enrichment_status: 'pending',
          outreach_status: 'pending'
        });
      }

      // Check if there are more pages
      const totalRecords = samData.totalRecords || 0;
      const fetched = (page + 1) * 100;
      if (fetched >= totalRecords) break;
      page++;
    }

    const dedupedUnique = matchedEntities.length;
    const alreadyInDatabase = samTotalFetched - dedupedUnique - (matchedEntities.filter(() => false).length);

    let contractorsImported = 0;
    let contractorsSkipped = 0;

    // 5. Upsert to Supabase in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < matchedEntities.length; i += chunkSize) {
      const chunk = matchedEntities.slice(i, i + chunkSize);
      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/contractors`,
        {
          method: 'POST',
          headers: {
            ...sbH(),
            'Prefer': 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(chunk)
        }
      );

      if (upsertRes.ok) {
        contractorsImported += chunk.length;
      } else {
        const errText = await upsertRes.text();
        console.error(`Upsert error for chunk ${i}:`, errText);
        contractorsSkipped += chunk.length;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        samTotalFetched,
        matchedFilters: dedupedUnique + contractorsSkipped,
        dedupedUnique,
        contractorsImported,
        contractorsSkipped,
        alreadyInDatabase: existingUEIs.size,
        dateRange
      })
    };
  } catch (err) {
    console.error('importer-sam error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
