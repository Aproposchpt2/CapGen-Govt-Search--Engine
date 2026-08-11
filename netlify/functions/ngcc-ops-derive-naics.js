// NGCC ops — requirements-based NAICS derivation.
// Retained as a backward-compatible internal endpoint. Stage 02 Contract DNA
// now uses the same shared intelligence implementation directly.
'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { fetchSamDescription, deriveNaics } = require('./lib/ngcc-contract-intelligence');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const noticeId = String(body.notice_id || '').trim();
  const title = String(body.title || '').trim();
  const agency = String(body.agency || '').trim();
  const samNaicsCode = String(body.naics_code || '').trim();
  if (!noticeId || !title) return json(400, { ok: false, error: 'notice_id and title are required.' });

  try {
    let description = '';
    let descriptionError = null;
    try { description = await fetchSamDescription(noticeId); }
    catch (error) {
      descriptionError = error.message;
      console.error('[ngcc-ops-derive-naics] description fetch failed:', error.message);
    }

    const derived = await deriveNaics({ title, agency, samNaicsCode, description });
    return json(200, {
      ok: true,
      sam_naics_code: samNaicsCode || null,
      primary_naics: derived.primary_naics || samNaicsCode || null,
      confirms_sam_code: derived.confirms_sam_code === true,
      additional_naics: Array.isArray(derived.additional_naics) ? derived.additional_naics.filter(Boolean) : [],
      rationale: derived.rationale || '',
      description_used: Boolean(description),
      description_error: descriptionError,
    });
  } catch (error) {
    console.error('[ngcc-ops-derive-naics]', error);
    return json(200, { ok: false, error: String(error?.message || 'NAICS derivation failed.') });
  }
};
