'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { MAX_SELECTED_CONTACTS, discoverSelectedContacts, mergeCapabilityVerifications } = require('./lib/ngcc-contact-discovery');
const { candidateKey } = require('./lib/ngcc-contractor-capability-verification');
const { rankCandidates, qualificationSummary } = require('./lib/ngcc-contractor-qualification');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const selected = candidates.filter(candidate => candidate.operator_selected === true || candidate.operator_disposition === 'APPROVED');
  if (!selected.length) return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: 'Select at least one ranked candidate before Stage 06 research.' });
  if (selected.length > MAX_SELECTED_CONTACTS) return json(409, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'BLOCKED', error: `Select no more than ${MAX_SELECTED_CONTACTS} businesses for one Stage 06 run.` });

  const contractDna = body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null;
  const businessSearchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;

  try {
    const { results, summary, outcome } = await discoverSelectedContacts(selected, {
      limit: body.limit || MAX_SELECTED_CONTACTS,
      contractDna,
      timeout_ms: body.timeout_ms,
    });

    const selectedKeys = new Set(selected.map(candidateKey));
    const freshCapability = new Map(results.filter(result => result.capability_verification).map(result => [candidateKey(result), result.capability_verification]));
    let reranked = null;
    let qualification = null;

    if (contractDna && businessSearchDna) {
      const enriched = candidates.map(candidate => {
        const fresh = freshCapability.get(candidateKey(candidate));
        return fresh ? { ...candidate, capability_verification: mergeCapabilityVerifications(candidate.capability_verification, fresh, candidate) } : candidate;
      });
      reranked = rankCandidates({ candidates: enriched, contractDna, businessSearchDna }).map(candidate => ({ ...candidate, operator_selected: selectedKeys.has(candidateKey(candidate)) }));
      qualification = qualificationSummary(reranked);
    }

    const rankedByKey = new Map((reranked || []).map(candidate => [candidateKey(candidate), candidate]));
    const contacts = results.map(result => {
      const refreshed = rankedByKey.get(candidateKey(result));
      return refreshed ? {
        ...result,
        qualification_rank: refreshed.rank || result.qualification_rank || null,
        qualification_score: refreshed.contract_qualification_score ?? refreshed.qualification_score ?? result.qualification_score ?? null,
        qualification_status: refreshed.qualification_status || result.qualification_status || null,
      } : result;
    });

    const payload = {
      stage: 'CONTACT_DISCOVERY',
      status: outcome.status,
      retry_required: outcome.retry_required,
      status_message: outcome.message,
      records_examined: selected.length,
      records_accepted: summary.VERIFIED || 0,
      records_rejected: (summary.NOT_FOUND || 0) + (summary.FAILED || 0),
      summary,
      contacts,
      ranked_candidates: reranked,
      qualification_summary: qualification,
      website_research_count: summary.WEBSITE_FOUND || 0,
      capability_refresh_count: summary.CAPABILITY_REFRESHED || 0,
    };

    if (outcome.retry_required) return json(200, { ok: false, ...payload, error: outcome.message });
    return json(200, { ok: true, ...payload });
  } catch (error) {
    console.error('[ngcc-ops-contact-discovery]', error);
    return json(200, { ok: false, stage: 'CONTACT_DISCOVERY', status: 'FAILED', error: String(error?.message || error) });
  }
};
