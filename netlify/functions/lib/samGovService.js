'use strict';

const SAM_GOV_V2_SEARCH_URL = 'https://api.sam.gov/opportunities/v2/search';

function formatSamDate(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function defaultPostedRange() {
  const postedTo = new Date();
  const postedFrom = new Date(postedTo);
  postedFrom.setDate(postedFrom.getDate() - 365);
  return {
    postedFrom: formatSamDate(postedFrom),
    postedTo: formatSamDate(postedTo),
  };
}

function clean(value) {
  return String(value || '').trim();
}

/**
 * Executes a search against the official SAM.gov Contract Opportunities v2 API.
 *
 * The API key is intentionally accepted by this server-side service and must
 * never be exposed to the Stage 01 browser client.
 *
 * @param {Object} filters
 * @param {string} [filters.keyword] Free-text opportunity-title search
 * @param {string} [filters.naics] NAICS code filter
 * @param {string} [filters.state] Place-of-performance state abbreviation
 * @param {string} [filters.setAsideCode] Optional SAM.gov set-aside code
 * @param {number} [filters.limit=30] Results per page
 * @param {number} [filters.offset=0] SAM.gov page index
 * @param {string} [filters.postedFrom] MM/dd/yyyy
 * @param {string} [filters.postedTo] MM/dd/yyyy
 * @param {string} apiKey Official SAM.gov public API key
 * @returns {Promise<Array>} Array of opportunity objects
 */
async function searchSamGovOpportunities(filters = {}, apiKey) {
  const page = await searchSamGovOpportunityPage(filters, apiKey);
  return page.opportunities;
}

/**
 * Page-aware variant used by NGCC Stage 01.
 *
 * SAM.gov requires postedFrom and postedTo, uses title for keyword searches,
 * and returns results in opportunitiesData.
 */
async function searchSamGovOpportunityPage(filters = {}, apiKey) {
  if (!clean(apiKey)) throw new Error('SAM.gov API key is required.');

  const range = defaultPostedRange();
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit, 10) || 30, 1000));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const keyword = clean(filters.keyword);
  const naics = clean(filters.naics);
  const state = clean(filters.state).toUpperCase();
  const setAsideCode = clean(filters.setAsideCode);

  if (state && !/^[A-Z]{2}$/.test(state)) {
    throw new Error('State must be a two-character state or territory code.');
  }
  if (naics && !/^\d{2,6}$/.test(naics)) {
    throw new Error('NAICS must contain 2 to 6 digits.');
  }

  const params = new URLSearchParams({
    api_key: clean(apiKey),
    limit: String(limit),
    offset: String(offset),
    postedFrom: clean(filters.postedFrom) || range.postedFrom,
    postedTo: clean(filters.postedTo) || range.postedTo,
  });

  if (keyword) params.set('title', keyword);
  if (naics) params.set('ncode', naics);
  if (state && state !== '(ALL STATES)' && state !== 'ALL STATES') params.set('state', state);
  if (setAsideCode) params.set('typeOfSetAside', setAsideCode);

  const response = await fetch(`${SAM_GOV_V2_SEARCH_URL}?${params.toString()}`, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
    throw new Error(`SAM.gov API error: ${response.statusText} (${response.status})${suffix}`);
  }

  const data = await response.json();
  const opportunities = Array.isArray(data.opportunitiesData)
    ? data.opportunitiesData
    : Array.isArray(data.opportunities)
      ? data.opportunities
      : [];

  return {
    opportunities,
    totalRecords: Math.max(0, Number(data.totalRecords || 0)),
    limit: Math.max(1, Number(data.limit || limit)),
    offset: Math.max(0, Number(data.offset ?? offset)),
  };
}

module.exports = {
  SAM_GOV_V2_SEARCH_URL,
  searchSamGovOpportunities,
  searchSamGovOpportunityPage,
};
