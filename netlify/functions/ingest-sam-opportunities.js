'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAM_API_KEY = process.env.SAM_API_KEY;
const OPP_URL = 'https://api.sam.gov/opportunities/v2/search';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal'
  };
}

function mmddyyyy(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear();
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalize(o, capturedAt) {
  return {
    notice_id: o.noticeId,
    title: o.title || null,
    solicitation_number: o.solicitationNumber || null,
    agency: o.fullParentPathName || o.department || o.subtier || null,
    notice_type: o.type || null,
    naics_code: o.naicsCode || null,
    set_aside: o.typeOfSetAsideDescription || o.setAside || null,
    posted_date: o.postedDate || null,
    response_deadline: o.responseDeadLine || null,
    ui_link: o.uiLink || (o.noticeId ? 'https://sam.gov/opp/' + o.noticeId + '/view' : null),
    raw: o,
    captured_at: capturedAt
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'GET or POST only' }) };
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !SAM_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Required environment variables are not configured' }) };
  }

  const q = event.queryStringParameters || {};
  const now = new Date();
  const days = Math.min(60, Math.max(1, parseInt(q.days || '14', 10)));
  const explicitFrom = parseDate(q.from);
  const explicitTo = parseDate(q.to);
  const to = explicitTo || now;
  const from = explicitFrom || new Date(to);
  if (!explicitFrom) from.setDate(from.getDate() - days);
  if (from > to) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'from must be on or before to' }) };

  const capturedAt = now.toISOString();
  let fetched = 0;
  let upserted = 0;
  let offset = 0;
  let totalRecords = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(OPP_URL);
      url.searchParams.set('api_key', SAM_API_KEY);
      url.searchParams.set('postedFrom', mmddyyyy(from));
      url.searchParams.set('postedTo', mmddyyyy(to));
      url.searchParams.set('limit', String(PAGE_LIMIT));
      url.searchParams.set('offset', String(offset));

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const text = await res.text();
        throw new Error('SAM.gov ' + res.status + ': ' + text.slice(0, 500));
      }

      const data = await res.json();
      const items = Array.isArray(data.opportunitiesData) ? data.opportunitiesData : [];
      if (totalRecords === null && Number.isFinite(Number(data.totalRecords))) totalRecords = Number(data.totalRecords);
      fetched += items.length;

      const rows = items.filter(o => o && o.noticeId).map(o => normalize(o, capturedAt));
      if (rows.length) {
        const upsertRes = await fetch(SUPABASE_URL + '/rest/v1/sam_opportunities?on_conflict=notice_id', {
          method: 'POST',
          headers: sbHeaders(),
          body: JSON.stringify(rows)
        });
        if (!upsertRes.ok) {
          const text = await upsertRes.text();
          throw new Error('Supabase upsert failed: ' + text.slice(0, 500));
        }
        upserted += rows.length;
      }

      offset += items.length;
      if (items.length < PAGE_LIMIT) break;
      if (totalRecords !== null && offset >= totalRecords) break;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, from: mmddyyyy(from), to: mmddyyyy(to), fetched, upserted, captured_at: capturedAt, total_records_reported: totalRecords, capped: totalRecords !== null && fetched < totalRecords })
    };
  } catch (err) {
    console.error('[ingest-sam-opportunities]', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
