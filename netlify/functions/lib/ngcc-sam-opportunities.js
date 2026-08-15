'use strict';

// Authoritative SAM.gov Contract Opportunities v2 request layer for NGCC.
// All NGCC surfaces that query SAM opportunities should use this module rather
// than constructing api.sam.gov URLs independently.

const SAM_BASE = 'https://api.sam.gov/opportunities/v2/search';

const SAM_SET_ASIDES = Object.freeze([
  { code: 'SBA', label: 'Total Small Business Set-Aside' },
  { code: 'SBP', label: 'Partial Small Business Set-Aside' },
  { code: '8A', label: '8(a) Set-Aside' },
  { code: '8AN', label: '8(a) Sole Source' },
  { code: 'HZC', label: 'HUBZone Set-Aside' },
  { code: 'HZS', label: 'HUBZone Sole Source' },
  { code: 'SDVOSBC', label: 'Service-Disabled Veteran-Owned Small Business Set-Aside' },
  { code: 'SDVOSBS', label: 'Service-Disabled Veteran-Owned Small Business Sole Source' },
  { code: 'WOSB', label: 'Women-Owned Small Business Program Set-Aside' },
  { code: 'WOSBSS', label: 'Women-Owned Small Business Program Sole Source' },
  { code: 'EDWOSB', label: 'Economically Disadvantaged WOSB Program Set-Aside' },
  { code: 'EDWOSBSS', label: 'Economically Disadvantaged WOSB Program Sole Source' },
  { code: 'LAS', label: 'Local Area Set-Aside' },
  { code: 'IEE', label: 'Indian Economic Enterprise Set-Aside' },
  { code: 'ISBEE', label: 'Indian Small Business Economic Enterprise Set-Aside' },
  { code: 'BICiv', label: 'Buy Indian Set-Aside' },
  { code: 'VSA', label: 'Veteran-Owned Small Business Set-Aside' },
  { code: 'VSS', label: 'Veteran-Owned Small Business Sole Source' },
]);

const SAM_NOTICE_TYPES = Object.freeze({
  u: 'Justification (J&A)',
  p: 'Pre-Solicitation',
  a: 'Award Notice',
  r: 'Sources Sought',
  s: 'Special Notice',
  o: 'Solicitation',
  g: 'Sale of Surplus Property',
  k: 'Combined Synopsis/Solicitation',
  i: 'Intent to Bundle Requirements',
});

function requestDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid SAM.gov request date.');
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function parseRequestDate(value, fieldName = 'date') {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${fieldName} is not a valid date.`);
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  let year;
  let month;
  let day;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) throw new Error(`${fieldName} must be MM/DD/YYYY or YYYY-MM-DD.`);
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} is not a valid calendar date.`);
  }
  return date;
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function normalizePostedWindow(rawFrom, rawTo, options = {}) {
  const defaultDays = Math.max(1, Math.min(Number(options.defaultDays || 365), 365));
  let from = parseRequestDate(rawFrom, 'postedFrom');
  let to = parseRequestDate(rawTo, 'postedTo');

  if (!from && !to) {
    to = todayUtc();
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - defaultDays);
  } else if (!from) {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - defaultDays);
  } else if (!to) {
    to = todayUtc();
  }

  if (from > to) throw new Error('postedFrom must be on or before postedTo.');

  const maxTo = new Date(from);
  maxTo.setUTCFullYear(maxTo.getUTCFullYear() + 1);
  if (to > maxTo) throw new Error('SAM.gov postedFrom/postedTo range cannot exceed one year.');

  return { postedFrom: requestDate(from), postedTo: requestDate(to), from, to };
}

function samDeadline(opportunity) {
  if (!opportunity) return null;
  // SAM's public response has historically exposed multiple spellings.
  return opportunity.reponseDeadLine || opportunity.responseDeadLine || opportunity.responseDeadline || null;
}

function isActiveOpportunity(opportunity) {
  const active = String(opportunity?.active ?? '').trim().toLowerCase();
  if (!active) return true;
  return ['yes', 'true', 'active', 'y', '1'].includes(active);
}

function parseSamResponsePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SAM.gov returned an invalid JSON response payload.');
  }

  const hasPrimaryCollection = Object.prototype.hasOwnProperty.call(data, 'opportunitiesData');
  const hasLegacyCollection = Object.prototype.hasOwnProperty.call(data, 'opportunities');

  if (hasPrimaryCollection && !Array.isArray(data.opportunitiesData)) {
    throw new Error('SAM.gov opportunitiesData was not an array.');
  }
  if (hasLegacyCollection && !Array.isArray(data.opportunities)) {
    throw new Error('SAM.gov opportunities was not an array.');
  }

  const rows = hasPrimaryCollection
    ? data.opportunitiesData
    : hasLegacyCollection
      ? data.opportunities
      : null;

  const hasTotalRecords = data.totalRecords !== undefined && data.totalRecords !== null && data.totalRecords !== '';
  const totalRecords = hasTotalRecords ? Number(data.totalRecords) : null;
  if (hasTotalRecords && (!Number.isFinite(totalRecords) || totalRecords < 0)) {
    throw new Error('SAM.gov totalRecords was not a valid non-negative number.');
  }

  // A zero-result search is a successful API response, even if SAM omits the
  // collection property. A non-zero response without an opportunity array is
  // malformed and must never be silently converted into an empty result set.
  if (rows === null) {
    if (totalRecords === 0) {
      return { rows: [], totalRecords: 0, payloadStatus: 'SUCCESS_EMPTY' };
    }
    throw new Error('SAM.gov returned HTTP 200 without an opportunity collection.');
  }

  return {
    rows,
    totalRecords: totalRecords === null ? rows.length : totalRecords,
    payloadStatus: rows.length ? 'SUCCESS_DATA' : 'SUCCESS_EMPTY',
  };
}

function responseRows(data) {
  return parseSamResponsePayload(data).rows;
}

function normalizeNoticeTypes(value) {
  const source = Array.isArray(value) ? value : value ? String(value).split(',') : [];
  return source.map(v => String(v).trim().toLowerCase()).filter(Boolean);
}

async function searchSamOpportunities(options = {}) {
  const apiKey = options.apiKey || process.env.SAM_API_KEY;
  if (!apiKey) throw new Error('SAM_API_KEY not configured');

  const window = normalizePostedWindow(options.postedFrom, options.postedTo, {
    defaultDays: options.defaultDays || 365,
  });
  const limit = Math.max(1, Math.min(parseInt(options.limit || '30', 10) || 30, 1000));
  const offset = Math.max(0, parseInt(options.offset || '0', 10) || 0);

  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: window.postedFrom,
    postedTo: window.postedTo,
    limit: String(limit),
    offset: String(offset),
  });

  const title = String(options.title || options.keyword || '').trim();
  const naicsCode = String(options.naicsCode || options.naics || '').trim();
  const psc = String(options.psc || '').trim();
  const state = String(options.state || '').trim().toUpperCase();
  const setAsideCode = String(options.setAsideCode || options.typeOfSetAside || '').trim();
  const noticeId = String(options.noticeId || options.noticeid || '').trim();

  if (title) params.set('title', title);
  if (naicsCode) params.set('ncode', naicsCode);
  if (psc) params.set('psc', psc);
  if (state) params.set('state', state);
  if (setAsideCode) params.set('typeOfSetAside', setAsideCode);
  if (noticeId) params.set('noticeid', noticeId);
  for (const type of normalizeNoticeTypes(options.noticeTypes || options.ptype)) {
    params.append('ptype', type);
  }

  const controllerSignal = options.signal || (
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(Math.max(1000, Number(options.timeoutMs || 30000)))
      : undefined
  );

  const response = await fetch(`${SAM_BASE}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': options.userAgent || 'APROPOS-NGCC/1.0',
    },
    signal: controllerSignal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SAM.gov ${response.status}: ${text.slice(0, 400)}`);
  }

  const data = await response.json();
  const parsed = parseSamResponsePayload(data);
  const rawRows = parsed.rows;
  const rows = options.activeOnly ? rawRows.filter(isActiveOpportunity) : rawRows;

  return {
    rows,
    rawCount: rawRows.length,
    activeCount: rows.length,
    payloadStatus: parsed.payloadStatus,
    resultStatus: rows.length ? 'SUCCESS_DATA' : 'SUCCESS_EMPTY',
    totalRecords: parsed.totalRecords,
    limit: Math.max(1, Number(data.limit || limit || 1)),
    offset: Math.max(0, Number(data.offset ?? offset ?? 0)),
    postedFrom: window.postedFrom,
    postedTo: window.postedTo,
    raw: data,
  };
}

module.exports = {
  SAM_BASE,
  SAM_SET_ASIDES,
  SAM_NOTICE_TYPES,
  requestDate,
  parseRequestDate,
  normalizePostedWindow,
  samDeadline,
  isActiveOpportunity,
  parseSamResponsePayload,
  responseRows,
  searchSamOpportunities,
};
