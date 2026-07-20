'use strict';
// GET ?noticeId={sam.gov notice id} -> { description }
// Server-side only: raw.description in sam_opportunities is a link to SAM.gov's
// description endpoint, not the text itself, and that endpoint requires the
// SAM_API_KEY. Fetched here so the key never reaches the client and so the
// opportunity details page never has to link out to sam.gov directly.

const SAM_API_KEY = process.env.SAM_API_KEY;
const DESC_URL = 'https://api.sam.gov/prod/opportunities/v1/noticedesc';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', middot: '·',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET only' }) };

  const noticeId = ((event.queryStringParameters || {}).noticeId || '').trim();
  if (!/^[a-z0-9]+$/i.test(noticeId)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid noticeId required' }) };
  }
  if (!SAM_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ description: null }) };
  }

  try {
    const url = DESC_URL + '?noticeid=' + encodeURIComponent(noticeId) + '&api_key=' + SAM_API_KEY;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { statusCode: 200, headers: CORS, body: JSON.stringify({ description: null }) };
    const data = await res.json();
    const raw = data.description || data.body || '';
    const text = stripHtml(raw);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ description: text || null }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ description: null }) };
  }
};
