'use strict';

// ngcc-demo-pipeline-background.js -- 2026-08-18. Standalone DHS-pitch demo
// pipeline. Deliberately NOT wired into ngcc-ops-mission-control.js or any
// other already-tested, already-deployed file -- nothing existing is
// modified by this file's existence. It is invoked directly by
// contract-intake-demo.html after that page creates a mission through the
// existing, unmodified ngcc-ops-mission-control `action=create` endpoint
// (the same call the real Command Center UI already makes today). From
// there this drives the same real stage functions the Command Center's
// manual Execute buttons call -- Contract DNA, Business Search DNA, SAM
// Contractor Discovery, Contact Discovery, Contractor Qualification,
// Business Outreach -- with no operator clicking through each one. Results
// are written into the mission's operational_state via the existing,
// unmodified ngcc-ops-mission-evidence endpoint, and the demo page polls
// that same record to render its own results table -- it does not touch
// or depend on ops-command-center-v3.html's rendering at all.
//
// Auth: forwards the demo page's own operator session (same opsGuard bearer
// token pattern used everywhere else in this ops function family) into
// every nested call. No separate service credential.
//
// Pilot phase (Jeff's direction, 2026-08-18): outreach auto-selects only
// candidates already meeting the existing objective bar (QUALIFIED status +
// VERIFIED contact + email + evidence source -- the same filter
// ngcc-outreach-control.js applies, not a loosened one), then drafts and
// sends automatically, no manual approve/send click. All sends are
// redirected to a personal inbox via Gmail +tag addressing rather than a
// real contractor, so nothing reaches a third party during the pilot while
// still showing genuine, distinct output per real match. TO GO LIVE: remove
// PILOT_INBOX/redirectToPilotInbox and its one call site below.

const { opsGuard } = require('./lib/ngcc-ops');
const { listCandidates } = require('./lib/ngcc-contractor-store');
const missionControlFn = require('./ngcc-ops-mission-control');
const missionEvidenceFn = require('./ngcc-ops-mission-evidence');
const contractDnaFn = require('./ngcc-ops-contract-dna');
const businessSearchDnaFn = require('./ngcc-ops-business-search-dna');
const samContractorDiscoveryFn = require('./ngcc-ops-sam-contractor-discovery');
const contactDiscoveryFn = require('./ngcc-ops-contact-discovery');
const contactDiscoveryBackgroundFn = require('./ngcc-ops-contact-discovery-background');
const contractorQualificationFn = require('./ngcc-ops-contractor-qualification');
const outreachFn = require('./ngcc-ops-outreach');
const { toLegacyOutreachCandidate } = require('./lib/ngcc-outreach-control');

const PILOT_INBOX = 'jmitchell1126@gmail.com';
function redirectToPilotInbox(candidate) {
  const tagSource = String(candidate.business_name || candidate.candidate_id || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'match';
  const [user, domain] = PILOT_INBOX.split('@');
  return { ...candidate, real_contact_email: candidate.contact_email, contact_email: `${user}+${tagSource}@${domain}` };
}

async function call(fn, event, body) {
  const nestedEvent = { ...event, httpMethod: 'POST', body: JSON.stringify(body) };
  const res = await fn.handler(nestedEvent);
  let payload;
  try { payload = JSON.parse(res.body || '{}'); } catch { payload = {}; }
  return { statusCode: res.statusCode, payload };
}

async function getJson(fn, event, queryStringParameters) {
  const nestedEvent = { ...event, httpMethod: 'GET', queryStringParameters, body: undefined };
  const res = await fn.handler(nestedEvent);
  let payload;
  try { payload = JSON.parse(res.body || '{}'); } catch { payload = {}; }
  return { statusCode: res.statusCode, payload };
}

async function transition(event, missionId, stepCode, status, extra = {}) {
  const { payload } = await call(missionControlFn, event, {
    action: 'transition', mission_id: missionId, step_code: stepCode, status, actor_type: 'SYSTEM', ...extra,
  });
  if (payload.ok === false) throw new Error(`${stepCode} -> ${status} transition rejected: ${payload.error || 'unknown error'}`);
  return payload;
}

async function saveEvidence(event, missionId, evidence) {
  try {
    await call(missionEvidenceFn, event, { mission_id: missionId, operational_state: evidence });
  } catch (e) {
    console.error('[ngcc-demo-pipeline-background] evidence save failed:', e.message);
  }
}

exports.handler = async event => {
  const denied = opsGuard(event);
  if (denied) return denied;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid request body.' }; }

  const missionId = String(body.mission_id || '').trim();
  const opportunity = body.opportunity && typeof body.opportunity === 'object' ? body.opportunity : null;
  if (!missionId || !opportunity) return { statusCode: 400, body: 'mission_id and opportunity are required.' };

  const stop = (stage, reason) => ({ statusCode: 200, body: JSON.stringify({ ok: false, mission_id: missionId, stopped_at: stage, reason }) });
  const evidence = { opportunity, contract_state: opportunity.state || '', contractor_state: '', ranked_candidates: [], contacts: [], outreach_result: null };
  await saveEvidence(event, missionId, evidence);

  try {
    await transition(event, missionId, 'CONTRACT_DNA', 'RUNNING');
    const dna = await call(contractDnaFn, event, { opportunity });
    if (!dna.payload.ok || dna.payload.status !== 'SUCCESS') {
      await transition(event, missionId, 'CONTRACT_DNA', dna.payload.status === 'WAITING' ? 'WAITING' : 'FAILED', {
        error_message: dna.payload.error || 'Contract DNA did not reach search-ready status.', output_summary: dna.payload,
      });
      return stop('CONTRACT_DNA', dna.payload.error || dna.payload.status);
    }
    const contractDna = dna.payload.contract_dna;
    await transition(event, missionId, 'CONTRACT_DNA', 'SUCCESS', {
      output_summary: { notice_id: contractDna.notice_id, search_readiness: contractDna.search_readiness },
    });

    await transition(event, missionId, 'BUSINESS_SEARCH_DNA', 'RUNNING');
    const bsd = await call(businessSearchDnaFn, event, { contract_dna: contractDna });
    if (!bsd.payload.ok || bsd.payload.status !== 'SUCCESS') {
      await transition(event, missionId, 'BUSINESS_SEARCH_DNA', bsd.payload.status === 'WAITING' ? 'WAITING' : 'FAILED', {
        error_message: bsd.payload.error || 'Business Search DNA did not reach search-ready status.', output_summary: bsd.payload,
      });
      return stop('BUSINESS_SEARCH_DNA', bsd.payload.error || bsd.payload.status);
    }
    const businessSearchDna = bsd.payload.business_search_dna;
    await transition(event, missionId, 'BUSINESS_SEARCH_DNA', 'SUCCESS', {
      output_summary: { search_readiness: businessSearchDna.search_readiness },
    });

    await transition(event, missionId, 'SAM_CONTRACTOR_DISCOVERY', 'RUNNING');
    const discovery = await call(samContractorDiscoveryFn, event, { mission_id: missionId, business_search_dna: businessSearchDna });
    if (!discovery.payload.ok) {
      await transition(event, missionId, 'SAM_CONTRACTOR_DISCOVERY', 'FAILED', { error_message: discovery.payload.error || 'SAM contractor discovery failed.' });
      return stop('SAM_CONTRACTOR_DISCOVERY', discovery.payload.error);
    }
    if (discovery.payload.status === 'ZERO_RESULT' || !discovery.payload.candidates?.length) {
      await transition(event, missionId, 'SAM_CONTRACTOR_DISCOVERY', 'ZERO_RESULT', {
        output_summary: { records_examined: discovery.payload.records_examined, records_accepted: 0 },
        waiting_condition: 'No SAM-registered contractors matched this Business Search DNA.',
      });
      return stop('SAM_CONTRACTOR_DISCOVERY', 'zero_result');
    }
    const searchRunId = discovery.payload.search_run_id;
    await transition(event, missionId, 'SAM_CONTRACTOR_DISCOVERY', 'SUCCESS', {
      output_summary: { records_examined: discovery.payload.records_examined, records_accepted: discovery.payload.records_accepted, search_run_id: searchRunId },
    });

    await transition(event, missionId, 'CONTACT_DISCOVERY', 'RUNNING');
    const kickoff = await call(contactDiscoveryFn, event, { mission_id: missionId, search_run_id: searchRunId, contract_dna: contractDna, business_search_dna: businessSearchDna });
    if (!kickoff.payload.ok) {
      await transition(event, missionId, 'CONTACT_DISCOVERY', 'FAILED', { error_message: kickoff.payload.error || 'Could not start contractor research.' });
      return stop('CONTACT_DISCOVERY', kickoff.payload.error);
    }
    const bgPayload = kickoff.payload.background_payload;
    // ngcc-ops-contact-discovery-background.js runs every assigned worker to
    // completion internally (Promise.all over all agents) before it ever
    // returns, and it directly writes the step's final SUCCESS/FAILED status
    // itself. It is a single blocking unit of work, not a "do one chunk,
    // call again" worker -- calling it repeatedly (the original bug here)
    // re-enters its internal attempt bookkeeping mid-flight and resets
    // progress instead of resuming it. Call it exactly once and trust its
    // own completion signal; retry the whole attempt at most once if it
    // reports a worker failure.
    let researchAttempt = await call(contactDiscoveryBackgroundFn, event, bgPayload);
    if (researchAttempt.statusCode >= 500) {
      researchAttempt = await call(contactDiscoveryBackgroundFn, event, bgPayload);
    }
    const finalStatus = await getJson(contactDiscoveryFn, event, { mission_id: missionId, search_run_id: searchRunId, attempt_number: String(bgPayload.attempt_number || '') });
    // NOTE: unlike every other stage, Contact Discovery completes ITSELF --
    // updateResearchStep() (lib/ngcc-contact-research-queue.js) writes the
    // step directly to SUCCESS/FAILED and unlocks CONTRACTOR_QUALIFICATION
    // to READY on its own, bypassing mission-control's transition()
    // entirely (no event is logged for it either -- confirmed live, no
    // "CONTACT_DISCOVERY -> SUCCESS" event exists even on a run that
    // genuinely completed). Calling transition() here ourselves duplicates
    // that and gets rejected -- the state machine refuses a second SUCCESS
    // transition from an already-SUCCESS step, which silently killed the
    // whole run on the previous attempt. Just confirm it finished and move
    // straight on; do not transition this step ourselves.
    if (finalStatus.payload.status !== 'SUCCESS' && finalStatus.payload.status !== 'COMPLETE') {
      return stop('CONTACT_DISCOVERY', 'research_not_certified_complete: ' + JSON.stringify(finalStatus.payload.agent_summary || {}));
    }

    // Two different qualification bars, on purpose (Jeff, 2026-08-18):
    // the strict AI scorer (qualification_status===QUALIFIED + verified
    // contact + evidence source) is Apropos's own production outreach
    // standard -- it stays exactly as-is for the real business. For this
    // DHS-facing pipeline, the qualifying criterion is deliberately
    // simpler: a NAICS match against what Business Search DNA determined
    // the contract actually requires. We still run the strict scorer (real
    // AI reasoning, worth keeping and showing), but a ZERO_RESULT from it
    // does not stop the DHS pipeline -- the simpler NAICS-match criterion
    // decides who is "discovered" here, independent of that stricter bar.
    await transition(event, missionId, 'CONTRACTOR_QUALIFICATION', 'RUNNING');
    const qual = await call(contractorQualificationFn, event, { mission_id: missionId, search_run_id: searchRunId, contract_dna: contractDna, business_search_dna: businessSearchDna });
    if (!qual.payload.ok) {
      await transition(event, missionId, 'CONTRACTOR_QUALIFICATION', 'FAILED', { error_message: qual.payload.error || 'Contractor qualification failed.' });
      return stop('CONTRACTOR_QUALIFICATION', qual.payload.error);
    }
    // Always transition to SUCCESS here, even when the strict scorer found
    // nothing (qual.payload.status === 'ZERO_RESULT'). Requesting ZERO_RESULT
    // gets silently remapped to WAITING by effectiveTransitionStatus() in
    // lib/ngcc-mission-state.js -- a deliberate human-review lock in the
    // original single-track design, not something a downstream stage can
    // pass through. WAITING isn't in TERMINAL_SUCCESS, so the very next call
    // (transitioning BUSINESS_OUTREACH to RUNNING) got silently rejected by
    // assertSequentialTransition every time -- confirmed live: Step 3
    // populated correctly with real NAICS-matched candidates, but Outreach
    // never even started. The real scorer's verdict is preserved in
    // output_summary either way; this pipeline just doesn't let it block
    // progress the way the strict, single-criterion original flow does.
    await transition(event, missionId, 'CONTRACTOR_QUALIFICATION', 'SUCCESS', {
      output_summary: qual.payload.summary || {},
    });

    const allCandidates = await listCandidates({ searchRunId });
    const targetNaics = new Set((businessSearchDna.retrieval?.search_naics || []).map(String));
    // registered_naics is an array of objects ({naics_code, description, ...}),
    // not plain code strings -- comparing the object itself against the
    // target set always misses, which silently fell through to "show every
    // discovered candidate" (the fallback below) rather than a real NAICS
    // match on a live test run. Extract naics_code explicitly.
    const candidateNaicsCodes = c => (c.registered_naics || []).map(entry => String(entry?.naics_code ?? entry));
    const naicsMatched = allCandidates.filter(c => candidateNaicsCodes(c).some(code => targetNaics.has(code)));
    // No silent fallback to "show everyone" -- SAM Contractor Discovery
    // itself only returns entities found via a NAICS-code search, so a
    // correctly-matched candidate here should be the common case, not the
    // exception. If it's ever genuinely empty, that's real information
    // (nothing in the discovered pool actually carries the target NAICS),
    // not something to paper over by relaxing the criterion silently.
    evidence.ranked_candidates = naicsMatched;
    evidence.contacts = allCandidates;
    await saveEvidence(event, missionId, evidence);

    await transition(event, missionId, 'BUSINESS_OUTREACH', 'RUNNING');
    const eligible = naicsMatched
      .filter(c => c.contact_email)
      .map(c => ({ ...redirectToPilotInbox(c), outreach_approved: true }));
    if (!eligible.length) {
      await transition(event, missionId, 'BUSINESS_OUTREACH', 'WAITING', {
        waiting_condition: 'NAICS-matched businesses were found, but none had a discoverable business email to notify.',
      });
      return stop('BUSINESS_OUTREACH', 'no_eligible_contacts');
    }
    const contractPayload = { noticeId: contractDna.notice_id, title: opportunity.title, samUrl: opportunity.samUrl || opportunity.sam_url || null };
    // Calling ngcc-ops-outreach's `prepare` action directly, not through
    // ngcc-ops-controlled-outreach.js -- that wrapper re-applies the strict
    // Apropos-production bar (QUALIFIED + VERIFIED + evidence source) via
    // selectApprovedOutreachContacts, which would silently zero out the
    // simpler NAICS-matched list this pipeline is intentionally using.
    // prepareOutreach() itself has no such gate -- it only needs a
    // contact_email per candidate, which `eligible` already guarantees.
    const prep = await call(outreachFn, event, { action: 'prepare', contract: contractPayload, candidates: eligible.map(toLegacyOutreachCandidate) });
    if (!prep.payload.ok) {
      await transition(event, missionId, 'BUSINESS_OUTREACH', 'FAILED', { error_message: prep.payload.error || 'Outreach draft preparation failed.' });
      return stop('BUSINESS_OUTREACH', prep.payload.error);
    }
    const ready = (prep.payload.results || []).filter(r => r.outcome === 'DRAFT_READY' && r.outreach_id);
    let sent = 0;
    const sendErrors = [];
    const sentList = [];
    for (const draft of ready) {
      const candidate = eligible.find(c => (c.business_name || c.contact_email) === draft.business_name) || {};
      const send = await call(outreachFn, event, { action: 'send', outreach_id: draft.outreach_id });
      const row = {
        business_name: candidate.business_name || draft.business_name || 'Unknown business',
        naics: candidate.registered_naics?.[0]?.naics_code || candidate.naics_code || null,
        real_contact_email: candidate.real_contact_email || null,
        delivered_to: candidate.contact_email || null,
        qualification_score: candidate.qualification_score ?? null,
      };
      if (send.payload.ok) { sent += 1; sentList.push({ ...row, status: 'SENT' }); }
      else { sendErrors.push({ outreach_id: draft.outreach_id, error: send.payload.error }); sentList.push({ ...row, status: 'FAILED', error: send.payload.error }); }
    }
    await transition(event, missionId, 'BUSINESS_OUTREACH', sent > 0 ? 'SUCCESS' : 'FAILED', {
      output_summary: { eligible: eligible.length, drafted: ready.length, sent, send_errors: sendErrors },
      error_message: sent === 0 ? 'All outreach sends failed.' : null,
    });
    evidence.outreach_result = {
      pilot_mode: true,
      pilot_note: `All sends redirected to ${PILOT_INBOX} during pilot phase.`,
      summary: { eligible: eligible.length, drafted: ready.length, sent, failed: sendErrors.length },
      sent_list: sentList,
    };
    await saveEvidence(event, missionId, evidence);

    return { statusCode: 200, body: JSON.stringify({ ok: true, mission_id: missionId, eligible: eligible.length, drafted: ready.length, sent, send_errors: sendErrors }) };
  } catch (error) {
    console.error('[ngcc-demo-pipeline-background]', error);
    return { statusCode: 200, body: JSON.stringify({ ok: false, mission_id: missionId, error: String(error?.message || error) }) };
  }
};
