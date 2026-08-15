// NGCC ops — live, on-demand SAM.gov Opportunities search for the internal
// proactive procurement command center.
//
// Governing inventory rule: operator-defined scope drives the search.
// Keyword, NAICS, and place-of-performance state are optional filters.
// SAM.gov remains the source of truth; NGCC does not force a set-aside class
// unless the operator explicitly supplies one.
'use strict';
const { json, opsGuard } = require('./lib/ngcc-ops');
const { searchSamGovOpportunityPage } = require('./lib/samGovService');
const SAM_KEY = process.env.SAM_API_KEY;

const SUPPORTED_SET_ASIDES = Object.freeze([
  { code: 'SBA', label: 'Total Small Business Set-Aside' },
  { code: 'SBP', label: 'Partial Small Business Set-Aside' },
  { code: '8A', label: '8(a) Set-Aside' },
  { code: 'HZC', label: 'HUBZone Set-Aside' },
  { code: 'SDVOSBC', label: 'Service-Disabled Veteran-Owned Small Business Set-Aside' },
  { code: 'WOSB', label: 'Women-Owned Small Business Program Set-Aside' },
  { code: 'EDWOSB', label: 'Economically Disadvantaged WOSB Program Set-Aside' },
  { code: 'LAS', label: 'Local Area Set-Aside' },
  { code: 'IEE', label: 'Indian Economic Enterprise Set-Aside' },
  { code: 'ISBEE', label: 'Indian Small Business Economic Enterprise Set-Aside' },
  { code: 'BICiv', label: 'Buy Indian Set-Aside' },
  { code: 'VSA', label: 'Veteran-Owned Small Business Set-Aside' },
]);
const SET_ASIDE_BY_CODE = new Map(SUPPORTED_SET_ASIDES.map(item => [item.code.toUpperCase(), item]));

function daysFromNow(d) {
  return Math.ceil((new Date(d) - new Date()) / 864e5);
}

function urgency(deadline) {
  if (!deadline) return 'ok';
  const d = daysFromNow(deadline);
  if (d < 0) return 'expired';
  if (d <= 7) return 'hot';
  if (d <= 14) return 'warm';
  return 'ok';
}

function formatDate(value) {
  if (!value) return null;
  const raw = String(value).trim();

  // SAM request dates are MM/dd/yyyy, while response dates are commonly ISO.
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return raw;
}

function mmddyyyy(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function postedFromDate(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return mmddyyyy(d);
}

function isActiveOpportunity(o) {
  const active = String(o?.active ?? '').trim().toLowerCase();
  if (!active) return true;
  return ['yes', 'true', 'active', 'y', '1'].includes(active);
}

function mapOpportunity(o, requestedSetAsideCode) {
  // SAM's public API documentation currently spells this field
  // "reponseDeadLine". Keep the known historical spellings as fallbacks.
  const rawDeadline = o.reponseDeadLine || o.responseDeadLine || o.responseDeadline || null;
  const deadline = formatDate(rawDeadline);
  const responseCode = String(o.setAsideCode || o.typeOfSetAside || requestedSetAsideCode || '').trim();
  const setAsideMeta = SET_ASIDE_BY_CODE.get(responseCode.toUpperCase());
  const place = o.placeOfPerformance || o.data?.placeOfPerformance || {};
  const stateObj = place.state || {};
  const state = String(stateObj.code || stateObj.stateCode || place.stateCode || '').trim().toUpperCase();
  const stateName = String(stateObj.name || stateObj.state || place.stateName || '').trim();

  return {
    noticeId: o.noticeId || o.solicitationNumber || '',
    solicitationNumber: o.solicitationNumber || '',
    title: o.title || 'Untitled Opportunity',
    agency: o.fullParentPathName || o.organizationName || o.department || '',
    organizationName: o.fullParentPathName || o.organizationName || o.department || '',
    naicsCode: o.naicsCode || '',
    setAsideCode: responseCode,
    setAside: o.setAside || o.typeOfSetAsideDescription || setAsideMeta?.label || responseCode || '',
    responseDeadline: deadline,
    urgency: urgency(deadline),
    postedDate: formatDate(o.postedDate) || o.postedDate || null,
    description: typeof o.description === 'string' ? o.description.slice(0, 1200) : '',
    descriptionUrl: typeof o.description === 'string' && /^https?:\/\//i.test(o.description) ? o.description : null,
    resourceLinks: Array.isArray(o.resourceLinks) ? o.resourceLinks.filter(Boolean) : [],
    additionalInfoLink: o.additionalInfoLink || null,
    state,
    stateName,
    placeOfPerformance: place,
    samUrl: o.uiLink || (o.noticeId ? `https://sam.gov/opp/${o.noticeId}/view` : 'https://sam.gov/content/opportunities'),
    type: o.type || 'Solicitation',
    active: o.active,
    source: 'SAM.gov Opportunities API',
  };
}

async function fetchOpportunities({ naicsCode, keyword, state, setAsideCode, limit, pageIndex }) {
  const page = await searchSamGovOpportunityPage({
    keyword,
    naics: naicsCode,
    state,
    setAsideCode,
    limit,
    offset: Math.max(0, pageIndex || 0),
  }, SAM_KEY);

  return {
    rows: page.opportunities.filter(isActiveOpportunity).map(o => mapOpportunity(o, setAsideCode)),
    totalRecords: page.totalRecords,
    limit: page.limit,
    offset: page.offset,
  };
}

function requestedSetAsideCodes(value) {
  const raw = String(value || '').trim();
  if (!raw) return [null];
  const codes = raw.split(',').map(code => code.trim()).filter(Boolean);
  const approved = [];
  for (const code of codes) {
    const meta = SET_ASIDE_BY_CODE.get(code.toUpperCase());
    if (meta && !approved.includes(meta.code)) approved.push(meta.code);
  }
  return approved;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };

  const denied = opsGuard(event);
  if (denied) return denied;
  if (!SAM_KEY) return json(500, { ok: false, error: 'SAM_API_KEY not configured', results: [] });

  const qs = event.queryStringParameters || {};
  const naicsParam = String(qs.naics || '').trim();
  const keywordParam = String(qs.keyword || qs.title || qs.q || '').trim();
  const stateParam = String(qs.state || '').trim().toUpperCase();

  if (stateParam && !/^[A-Z]{2}$/.test(stateParam)) {
    return json(400, { ok: false, error: 'State must be a two-character state or territory code.', results: [] });
  }

  const limit = Math.max(1, Math.min(parseInt(qs.limit || '30', 10) || 30, 100));
  const page = Math.max(1, Math.min(parseInt(qs.page || '1', 10) || 1, 1000));
  const pageIndex = page - 1;
  const setAsideCodes = requestedSetAsideCodes(qs.set_aside || qs.setAside || '');

  if (!setAsideCodes.length) {
    return json(400, { ok: false, error: 'Unsupported set-aside code supplied.', results: [] });
  }

  const naicsCodes = naicsParam
    ? naicsParam.split(',').map(n => n.trim()).filter(Boolean).slice(0, 10)
    : [null];

  const paths = [];
  for (const setAsideCode of setAsideCodes) {
    for (const naicsCode of naicsCodes) paths.push({ setAsideCode, naicsCode });
  }

  try {
    const results = [];
    const seen = new Set();
    const execution = [];
    const pageSignals = [];
    const perPath = paths.length === 1
      ? limit
      : Math.max(10, Math.min(100, Math.ceil(limit / Math.max(1, Math.min(paths.length, 4))) * 2));
    const concurrency = 4;

    for (let i = 0; i < paths.length && results.length < limit; i += concurrency) {
      const group = paths.slice(i, i + concurrency);
      const batches = await Promise.all(group.map(async path => {
        try {
          const batch = await fetchOpportunities({
            naicsCode: path.naicsCode,
            keyword: keywordParam || undefined,
            state: stateParam || undefined,
            setAsideCode: path.setAsideCode || undefined,
            limit: perPath,
            pageIndex,
          });

          execution.push({
            ...path,
            setAsideCode: path.setAsideCode || null,
            state: stateParam || null,
            returned: batch.rows.length,
            totalRecords: batch.totalRecords,
            samOffset: batch.offset,
            status: 'SUCCESS',
          });
          pageSignals.push({ totalRecords: batch.totalRecords, limit: batch.limit, offset: batch.offset });
          return batch.rows;
        } catch (error) {
          console.error('[ngcc-ops-sam-opportunities]', path.setAsideCode || 'ANY', path.naicsCode, stateParam, error.message);
          execution.push({
            ...path,
            setAsideCode: path.setAsideCode || null,
            state: stateParam || null,
            returned: 0,
            totalRecords: 0,
            samOffset: pageIndex,
            status: 'FAILED',
            error: error.message,
          });
          return [];
        }
      }));

      for (const batch of batches) {
        for (const opp of batch) {
          if (opp.urgency === 'expired' || !opp.noticeId || seen.has(opp.noticeId)) continue;
          seen.add(opp.noticeId);
          results.push(opp);
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
    }

    results.sort((a, b) => {
      const order = { hot: 0, warm: 1, ok: 2 };
      const diff = (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
      if (diff !== 0) return diff;
      if (a.responseDeadline && b.responseDeadline) return new Date(a.responseDeadline) - new Date(b.responseDeadline);
      return 0;
    });

    const hasNext = pageSignals.some(signal => signal.totalRecords > ((signal.offset + 1) * signal.limit));
    const totalRecords = pageSignals.length === 1 ? pageSignals[0].totalRecords : null;

    return json(200, {
      ok: true,
      inventory: setAsideCodes[0] ? 'ACTIVE_FEDERAL_OPPORTUNITIES_FILTERED_BY_SET_ASIDE' : 'ACTIVE_FEDERAL_OPPORTUNITIES',
      source: 'SAM.gov Opportunities API',
      setAsideCodes: setAsideCodes.filter(Boolean),
      naicsCodes: naicsCodes.filter(Boolean),
      keyword: keywordParam || null,
      title: keywordParam || null,
      state: stateParam || null,
      returned: Math.min(results.length, limit),
      page,
      page_size: limit,
      total_records: totalRecords,
      has_previous: page > 1,
      has_next: hasNext,
      results: results.slice(0, limit),
      execution,
    });
  } catch (error) {
    console.error('[ngcc-ops-sam-opportunities]', error.message);
    return json(500, { ok: false, error: error.message, results: [] });
  }
};
