// NGCC ops — live, on-demand SAM.gov Opportunities search by NAICS code,
// for the internal outreach tool's "pick a contract" step.
//
// This repo already has ingest-sam-opportunities.js, a batch importer that
// upserts pages of SAM.gov opportunities into a table for the subscriber
// dashboard. This function is deliberately different: a live, on-demand
// query straight to SAM.gov (same shape as the entity search in
// ngcc-sam-entity-search.js), scoped to the internal ops tool only, so a
// contract picked here is always current rather than only as fresh as the
// last batch import.
'use strict';
const { json, opsGuard } = require('./lib/ngcc-ops');

const SAM_BASE = 'https://api.sam.gov/opportunities/v2/search';
const SAM_KEY = process.env.SAM_API_KEY;

function daysFromNow(d) { return Math.ceil((new Date(d) - new Date()) / 864e5); }
function urgency(deadline) {
  if (!deadline) return 'ok';
  const d = daysFromNow(deadline);
  if (d < 0) return 'expired';
  if (d <= 7) return 'hot';
  if (d <= 14) return 'warm';
  return 'ok';
}
function formatDate(mmddyyyy) {
  const [m, d, y] = String(mmddyyyy || '').split('/');
  return (y && m && d) ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
}
function postedFromDate(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
}
function mapOpportunity(o) {
  const deadline = formatDate(o.responseDeadLine) || o.responseDeadLine || null;
  return {
    noticeId: o.noticeId || o.solicitationNumber || '',
    title: o.title || 'Untitled Opportunity',
    agency: o.organizationName || o.department || '',
    naicsCode: o.naicsCode || '',
    setAside: o.typeOfSetAside || o.setAside || '',
    responseDeadline: deadline,
    urgency: urgency(deadline),
    postedDate: formatDate(o.postedDate) || o.postedDate || null,
    description: (o.description || '').slice(0, 300),
    samUrl: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
    type: o.type || 'Solicitation',
    active: o.active,
  };
}
// naicsCode and title are both optional now -- browsing recent open
// opportunities with neither is a real, supported mode (Jeff's actual
// workflow starts from contracts, not from a NAICS code the operator has
// to already know). postedFrom/postedTo are the only truly required SAM.gov
// params, confirmed against GSA's own docs.
async function fetchOpportunities({ naicsCode, title, limit }) {
  const today = new Date();
  const params = new URLSearchParams({
    api_key: SAM_KEY, active: 'Yes', limit: String(limit),
    postedFrom: postedFromDate(90),
    postedTo: `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`,
  });
  if (naicsCode) params.set('naicsCode', naicsCode);
  if (title) params.set('title', title);
  const res = await fetch(`${SAM_BASE}?${params.toString()}`);
  if (!res.ok) { const t = await res.text(); throw new Error(`SAM ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  return (data.opportunitiesData || []).map(mapOpportunity);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (!SAM_KEY) return json(500, { ok: false, error: true, message: 'SAM_API_KEY not configured', results: [] });

  const qs = event.queryStringParameters || {};
  const naicsParam = (qs.naics || '').trim();
  const titleParam = (qs.title || '').trim();
  const limit = Math.min(parseInt(qs.limit || '50', 10), 200);

  const naicsCodes = naicsParam ? naicsParam.split(',').map(n => n.trim()).filter(Boolean).slice(0, 10) : [null];
  try {
    const perCode = Math.max(10, Math.floor(limit / naicsCodes.length));
    const batches = await Promise.all(naicsCodes.map(n => fetchOpportunities({ naicsCode: n, title: titleParam || undefined, limit: perCode }).catch(e => { console.error('[ngcc-ops-sam-opportunities]', n, e.message); return []; })));
    const seen = new Set();
    const results = [];
    for (const batch of batches) for (const opp of batch) {
      if (opp.urgency === 'expired' || seen.has(opp.noticeId)) continue;
      seen.add(opp.noticeId);
      results.push(opp);
    }
    results.sort((a, b) => {
      const order = { hot: 0, warm: 1, ok: 2 };
      const diff = (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
      if (diff !== 0) return diff;
      if (a.responseDeadline && b.responseDeadline) return new Date(a.responseDeadline) - new Date(b.responseDeadline);
      return 0;
    });
    return json(200, { ok: true, naicsCodes: naicsCodes.filter(Boolean), title: titleParam || null, total: results.length, returned: Math.min(results.length, limit), results: results.slice(0, limit) });
  } catch (error) {
    console.error('[ngcc-ops-sam-opportunities]', error.message);
    return json(200, { ok: false, error: true, message: error.message, results: [] });
  }
};
