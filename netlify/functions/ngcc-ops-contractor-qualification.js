'use strict';

const { json, opsGuard } = require('./lib/ngcc-ops');
const { rankCandidates, qualificationSummary } = require('./lib/ngcc-contractor-qualification');
const {
  currentRun,
  listCandidates,
  persistQualifications,
  updateSearchRun,
} = require('./lib/ngcc-contractor-store');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid request body.' }); }

  const missionId = String(body.mission_id || '').trim();
  const contractDna = body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null;
  const businessSearchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;

  if (!contractDna) return json(400, { ok: false, error: 'contract_dna is required.' });
  if (!businessSearchDna) return json(400, { ok: false, error: 'business_search_dna is required.' });
  if (businessSearchDna.search_readiness !== 'READY') {
    return json(409, { ok: false, stage: 'CONTRACTOR_QUALIFICATION', status: 'BLOCKED', error: 'Business Search DNA is not READY.' });
  }

  try {
    let run = null;
    if (body.search_run_id) run = { id: String(body.search_run_id).trim() };
    else if (missionId) run = await currentRun(missionId);

    const candidates = run?.id ? await listCandidates({ searchRunId: run.id }) : [];
    if (!candidates.length) {
      return json(409, {
        ok: false,
        stage: 'CONTRACTOR_QUALIFICATION',
        status: 'BLOCKED',
        error: 'No persisted Stage 04 contractor candidates are available to qualify.',
      });
    }

    const researchIncomplete = candidates.filter(candidate => !['SUCCESS', 'NOT_FOUND', 'FAILED'].includes(String(candidate.research_status || '').toUpperCase()));
    if (researchIncomplete.length) {
      return json(409, {
        ok: false,
        stage: 'CONTRACTOR_QUALIFICATION',
        status: 'BLOCKED',
        error: `Contractor Qualification requires Stage 05 research to finish first. ${researchIncomplete.length} candidate(s) remain unresearched.`,
      });
    }

    const ranked = rankCandidates({ candidates, contractDna, businessSearchDna });
    const summary = qualificationSummary(ranked);
    const durableRanked = run?.id ? await persistQualifications(run.id, ranked) : ranked;
    const outreachReady = durableRanked.filter(candidate =>
      candidate.qualification_status === 'QUALIFIED' &&
      candidate.contact_verified === true &&
      candidate.contact_email &&
      (candidate.contact_source_url || candidate.source_url)
    ).length;

    if (run?.id) {
      await updateSearchRun(run.id, {
        status: summary.qualified > 0 ? 'QUALIFICATION_COMPLETE' : 'NO_QUALIFIED_CONTRACTORS',
        records_examined: candidates.length,
        records_accepted: summary.qualified + summary.review_required + summary.insufficient_evidence,
        records_rejected: summary.disqualified,
        completed_at: new Date().toISOString(),
      });
    }

    return json(200, {
      ok: true,
      stage: 'CONTRACTOR_QUALIFICATION',
      status: summary.qualified > 0 ? 'SUCCESS' : 'ZERO_RESULT',
      search_run_id: run?.id || null,
      records_examined: candidates.length,
      records_accepted: summary.qualified + summary.review_required + summary.insufficient_evidence,
      records_rejected: summary.disqualified,
      summary,
      outreach_ready_count: outreachReady,
      ranked_candidates: durableRanked,
      qualification_policy: 'Stage 06 performs no live web research. It scores the durable SAM contractor records using Contract DNA plus the public website/capability/contact evidence collected during Stage 05. Missing evidence remains INSUFFICIENT_EVIDENCE and affirmative mismatches remain disqualifying.',
      persistence: run?.id ? 'DURABLE — qualification updated the same contractor rows researched during Stage 05.' : 'UNAVAILABLE — a persisted search run is required.',
    });
  } catch (error) {
    console.error('[rfcp-ops-contractor-qualification]', error);
    return json(200, {
      ok: false,
      stage: 'CONTRACTOR_QUALIFICATION',
      status: 'FAILED',
      error: String(error?.message || 'Contractor qualification failed.'),
    });
  }
};
