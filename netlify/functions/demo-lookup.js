'use strict';
// demo-lookup.js
// POST { business_name } → SAM.gov search → returns entity + pipeline preview
// Used by the "See Live Demo" flow on the landing page.

const SAM_API_KEY = process.env.SAM_API_KEY;
const SUPABASE_URL = 'https://judislfknmhofcgzyozc.supabase.co';
const OPP_URL     = 'https://api.sam.gov/opportunities/v2/search';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function mmddyyyy(d) {
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
}

function daysUntil(deadline) {
  if (!deadline) return null;
  return Math.floor((new Date(deadline) - new Date()) / (1000*60*60*24));
}

async function searchEntity(name) {
  if (!SAM_API_KEY) return null;
  const url = new URL('https://api.sam.gov/entity-information/v3/entities');
  url.searchParams.set('api_key', SAM_API_KEY);
  url.searchParams.set('legalBusinessName', name);
  url.searchParams.set('registrationStatus', 'A');
  url.searchParams.set('includeSections', 'entityRegistration,coreData,assertions');
  try {
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    const e    = (data.entityData || [])[0];
    if (!e) return null;
    const reg = e.entityRegistration || {};
    const gs  = (e.assertions && e.assertions.goodsAndServices) || {};
    const bt  = (e.coreData && e.coreData.businessTypes && e.coreData.businessTypes.sbaBusinessTypeList) || [];
    return {
      found:       true,
      legal_name:  reg.legalBusinessName || name,
      uei:         reg.ueiSAM || null,
      cage:        reg.cageCode || null,
      sam_status:  reg.registrationStatus === 'A' ? 'Active' : 'Unknown',
      naics:       (gs.naicsList || []).map(n => n.naicsCode).filter(Boolean),
      certs:       bt.filter(c => !c.certificationExitDate || new Date(c.certificationExitDate) > new Date())
                    .map(c => c.sbaBusinessTypeDesc || c.sbaBusinessTypeDescription).filter(Boolean),
    };
  } catch(e) { console.warn('Entity search error:', e.message); return null; }
}

async function fetchOpps(naics, days = 30) {
  if (!SAM_API_KEY) return [];
  const now  = new Date();
  const from = new Date(now); from.setDate(from.getDate() - days);
  const seen = new Map();
  for (const code of naics.slice(0, 4)) { // limit to 4 codes for demo speed
    try {
      const url = new URL(OPP_URL);
      url.searchParams.set('api_key', SAM_API_KEY);
      url.searchParams.set('postedFrom', mmddyyyy(from));
      url.searchParams.set('postedTo',   mmddyyyy(now));
      url.searchParams.set('ncode', code);
      url.searchParams.set('limit', '25');
      url.searchParams.set('offset', '0');
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      for (const o of (data.opportunitiesData || [])) {
        if (!o.noticeId || seen.has(o.noticeId)) continue;
        const dl = daysUntil(o.responseDeadLine);
        if (dl !== null && dl < 1) continue; // skip closed
        seen.set(o.noticeId, {
          title:    o.title,
          agency:   o.fullParentPathName,
          type:     o.type,
          naics:    o.naicsCode,
          set_aside: o.typeOfSetAsideDescription || 'None',
          deadline:  o.responseDeadLine,
          days_left: dl,
          url:      o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
        });
      }
    } catch(e) { console.warn('Opp fetch error:', e.message); }
  }
  return [...seen.values()]
    .filter(o => o.days_left === null || o.days_left >= 1)
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1; if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    })
    .slice(0, 20);
}

// Fallback NAICS for businesses not in SAM
const DEMO_NAICS = ['541519','541511','541512','518210'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const name = (body.business_name || '').trim();
  if (!name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'business_name required' }) };

  // 1. Look up entity in SAM.gov
  const entity = await searchEntity(name);

  // 2. Determine NAICS to use
  const naics = entity && entity.naics.length > 0 ? entity.naics : DEMO_NAICS;

  // 3. Pull live opportunities
  const opps = await fetchOpps(naics);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      entity: entity || { found: false, legal_name: name, sam_status: 'Demo Mode', naics: DEMO_NAICS, certs: [], uei: null, cage: null },
      opportunities: opps,
      total: opps.length,
    }),
  };
};
