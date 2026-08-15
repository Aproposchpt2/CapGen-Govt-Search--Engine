'use strict';
// GET ?t={beta_access_token}&days={60|30|7}
// Forked from demo-pipeline.js. Reads NAICS from beta_testers, never touches demo_snapshots.
// Updates login tracking on every call.

const { searchSamOpportunities, samDeadline } = require('./lib/ngcc-sam-opportunities');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SAM_API_KEY  = process.env.SAM_API_KEY;
const PAGE_LIMIT   = 50;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function sbH() { return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }; }

function daysUntil(deadline) {
  if (!deadline) return null;
  return Math.floor((new Date(deadline) - new Date()) / 86400000);
}

function urgencyClass(days) {
  if (days === null || days < 1) return 'none';
  if (days <= 7)  return 'hot';
  if (days <= 30) return 'warm';
  return 'ok';
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET only' }) };

  const q     = event.queryStringParameters || {};
  const token = (q.t || '').trim();
  const days  = Math.min(90, Math.max(1, parseInt(q.days || '60', 10)));

  if (!token || !token.startsWith('beta_'))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid beta token required' }) };
  if (!SAM_API_KEY)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'SAM_API_KEY not set' }) };

  // Load beta tester row
  const testerRes = await fetch(
    `${SUPABASE_URL}/rest/v1/beta_testers?access_token=eq.${encodeURIComponent(token)}&status=eq.active&limit=1`,
    { headers: sbH() }
  );
  if (!testerRes.ok) return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Database error' }) };
  const testers = await testerRes.json();
  if (!testers.length) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Beta access not found or inactive' }) };

  const tester = testers[0];
  if (tester.token_expires_at && new Date(tester.token_expires_at) < new Date())
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Beta access has expired' }) };

  // Build NAICS list from beta_testers row
  const naicsCodes = [tester.primary_naics, ...(tester.additional_naics || [])].filter(Boolean);

  // Update login tracking (non-blocking)
  fetch(`${SUPABASE_URL}/rest/v1/beta_testers?id=eq.${tester.id}`, {
    method: 'PATCH',
    headers: { ...sbH(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ last_login_at: new Date().toISOString(), login_count: (tester.login_count || 0) + 1 }),
  }).catch(() => {});

  if (!naicsCodes.length)
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ client: { name: tester.company_name, naics: [] }, opportunities: [] }) };

  // Fetch live SAM.gov opportunities through the authoritative NGCC SAM layer.
  const now  = new Date();
  const from = new Date(now); from.setDate(from.getDate() - days);
  const seen = new Map();

  for (let i = 0; i < Math.min(naicsCodes.length, 8); i++) {
    const naics = naicsCodes[i];
    try {
      const batch = await searchSamOpportunities({
        apiKey: SAM_API_KEY,
        postedFrom: from,
        postedTo: now,
        naicsCode: naics,
        limit: PAGE_LIMIT,
        offset: 0,
        activeOnly: true,
        userAgent: 'APROPOS-NGCC-Beta-Pipeline/1.0',
      });
      for (const o of batch.rows) {
        if (!o.noticeId || seen.has(o.noticeId)) continue;
        const deadline = samDeadline(o);
        const dl = daysUntil(deadline);
        if (dl !== null && dl < 1) continue;
        seen.set(o.noticeId, {
          notice_id:   o.noticeId,
          title:       o.title,
          agency:      o.fullParentPathName,
          type:        o.type,
          naics:       o.naicsCode,
          set_aside:   o.typeOfSetAsideDescription || o.setAside || 'None',
          posted_date: o.postedDate,
          deadline:    deadline,
          days_left:   dl,
          urgency:     urgencyClass(dl),
          url:         o.uiLink || ('https://sam.gov/opp/' + o.noticeId + '/view'),
          state:       (o.placeOfPerformance && o.placeOfPerformance.state && o.placeOfPerformance.state.code) || null,
          city:        (o.placeOfPerformance && o.placeOfPerformance.city && o.placeOfPerformance.city.name) || null,
        });
      }
    } catch(e) { console.error('[beta-pipeline] NAICS', naics, ':', e.message); }
  }

  const results = [...seen.values()]
    .filter(o => o.days_left !== null && o.days_left >= 1)
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      client: {
        name:          tester.company_name,
        naics:         naicsCodes,
        primary_naics: tester.primary_naics,
        certifications: [],
      },
      window_days:   days,
      total:         results.length,
      opportunities: results,
    }),
  };
};
