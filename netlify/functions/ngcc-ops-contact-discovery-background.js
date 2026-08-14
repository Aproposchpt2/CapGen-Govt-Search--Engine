'use strict';

const { opsGuard } = require('./lib/ngcc-ops');
const {
  discoverPublicContact,
  mergeCapabilityVerifications,
} = require('./lib/ngcc-contact-discovery');
const { rankCandidates, qualificationSummary } = require('./lib/ngcc-contractor-qualification');
const {
  listCandidates,
  listContactAgents,
  updateAgent,
  updateCandidateContact,
  summarizeAgents,
  updateContactStep,
  persistQualifications,
  updateSearchRun,
  recordEvent,
  nowIso,
} = require('./lib/ngcc-contractor-store');

const MAX_RESEARCH_ATTEMPTS = 3;
const RESEARCH_TIMEBOX_MS = 115000;

async function refreshProgress(missionId, searchRunId, attemptNumber) {
  const agents = await listContactAgents({ searchRunId, attemptNumber });
  const summary = summarizeAgents(agents);
  const selected = await listCandidates({ searchRunId, selectedOnly: true });
  const verified = selected.filter(candidate => candidate.contact_verified).length;
  await updateContactStep(missionId, {
    status: 'RUNNING',
    progress: summary.progress_percentage,
    activity: `${summary.completed}/${summary.total} assigned Stage 06 agent(s) complete. ${verified} verified public contact(s) stored.`,
    summary: {
      search_run_id: searchRunId,
      attempt_number: attemptNumber,
      assigned_agents: summary.total,
      completed_agents: summary.completed,
      verified_contacts: verified,
      failed_agents: summary.failed,
      not_found_agents: summary.not_found,
    },
  });
  return { agents, summary, verified };
}

async function researchOne({ agent, candidate, contractDna, missionId, searchRunId, attemptNumber }) {
  const businessName = candidate.business_name || candidate.businessName || `Agent ${agent.agent_slot}`;
  await updateAgent(agent.id, {
    status: 'RUNNING',
    progress_percentage: 10,
    current_activity: `Locating the official website for ${businessName}`,
    started_at: agent.started_at || nowIso(),
    last_heartbeat_at: nowIso(),
    error_message: null,
  });
  await refreshProgress(missionId, searchRunId, attemptNumber);

  let result = null;
  let lastError = null;
  for (let pass = 1; pass <= MAX_RESEARCH_ATTEMPTS; pass += 1) {
    try {
      const progress = pass === 1 ? 30 : pass === 2 ? 55 : 75;
      await updateAgent(agent.id, {
        status: 'RUNNING',
        progress_percentage: progress,
        current_activity: pass === 1
          ? `Searching official website and published public contact sources for ${businessName}`
          : `Research pass ${pass}/${MAX_RESEARCH_ATTEMPTS}: continuing verified contact search for ${businessName}`,
        last_heartbeat_at: nowIso(),
      });
      await refreshProgress(missionId, searchRunId, attemptNumber);
      result = await discoverPublicContact(candidate, {
        contractDna,
        timeout_ms: RESEARCH_TIMEBOX_MS,
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!result) {
    const message = String(lastError?.message || lastError || 'Website/contact research failed.');
    await updateCandidateContact(candidate.candidate_id, {
      contact_status: 'FAILED',
      research_status: 'FAILED',
      contact_email: null,
      official_website_url: candidate.official_website_url || null,
      website_pages_checked: candidate.website_pages_checked || [],
      capability_verification: candidate.capability_verification || {},
      evidence_note: message,
    });
    await updateAgent(agent.id, {
      status: 'FAILED',
      progress_percentage: 100,
      current_activity: `Research completed with a controlled failure for ${businessName}`,
      result_summary: { contact_status: 'FAILED', business_name: businessName },
      error_message: message,
      completed_at: nowIso(),
      last_heartbeat_at: nowIso(),
    });
    await refreshProgress(missionId, searchRunId, attemptNumber);
    return;
  }

  result.capability_verification = mergeCapabilityVerifications(
    candidate.capability_verification,
    result.capability_verification,
    candidate
  ) || candidate.capability_verification || {};
  result.research_status = result.contact_status === 'VERIFIED' ? 'SUCCESS' : 'NOT_FOUND';
  const persisted = await updateCandidateContact(candidate.candidate_id, result);
  const terminalStatus = result.contact_status === 'VERIFIED' ? 'SUCCESS' : 'NOT_FOUND';

  await updateAgent(agent.id, {
    status: terminalStatus,
    progress_percentage: 100,
    current_activity: result.contact_status === 'VERIFIED'
      ? `Verified public email stored for ${businessName}`
      : `Research complete for ${businessName}; no verified public email was found`,
    result_summary: {
      business_name: businessName,
      official_website_url: persisted?.official_website_url || null,
      contact_status: persisted?.contact_status || result.contact_status,
      contact_verified: Boolean(persisted?.contact_verified),
      contact_source_url: persisted?.contact_source_url || null,
    },
    error_message: null,
    completed_at: nowIso(),
    last_heartbeat_at: nowIso(),
  });
  await refreshProgress(missionId, searchRunId, attemptNumber);
}

exports.handler = async event => {
  const denied = opsGuard(event);
  if (denied) return denied;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid request body.' }; }

  const missionId = String(body.mission_id || '').trim();
  const searchRunId = String(body.search_run_id || '').trim();
  const attemptNumber = Number(body.attempt_number || 0);
  const contractDna = body.contract_dna && typeof body.contract_dna === 'object' ? body.contract_dna : null;
  const businessSearchDna = body.business_search_dna && typeof body.business_search_dna === 'object' ? body.business_search_dna : null;

  if (!missionId || !searchRunId || !attemptNumber) {
    return { statusCode: 400, body: 'mission_id, search_run_id, and attempt_number are required.' };
  }

  try {
    const [agents, selected] = await Promise.all([
      listContactAgents({ searchRunId, attemptNumber }),
      listCandidates({ searchRunId, selectedOnly: true }),
    ]);
    const byId = new Map(selected.map(candidate => [candidate.candidate_id, candidate]));
    if (!agents.length) throw new Error('No Stage 06 agent assignments were found.');

    await Promise.all(agents.map(async agent => {
      const candidate = byId.get(agent.candidate_id);
      if (!candidate) {
        await updateAgent(agent.id, {
          status: 'FAILED',
          progress_percentage: 100,
          current_activity: 'Assigned contractor record is unavailable.',
          error_message: 'Persisted contractor candidate was not found.',
          completed_at: nowIso(),
          last_heartbeat_at: nowIso(),
        });
        return;
      }
      await researchOne({ agent, candidate, contractDna, missionId, searchRunId, attemptNumber });
    }));

    const allCandidates = await listCandidates({ searchRunId });
    let durableRanked = allCandidates;
    if (contractDna && businessSearchDna) {
      const ranked = rankCandidates({ candidates: allCandidates, contractDna, businessSearchDna });
      durableRanked = await persistQualifications(searchRunId, ranked);
    }
    const qualification = qualificationSummary(durableRanked);

    const finalAgents = await listContactAgents({ searchRunId, attemptNumber });
    const agentSummary = summarizeAgents(finalAgents);
    const finalSelected = await listCandidates({ searchRunId, selectedOnly: true });
    const verifiedContacts = finalSelected.filter(candidate => candidate.contact_verified).length;

    if (!agentSummary.all_terminal) {
      throw new Error('Stage 06 reconciliation was reached before every assigned agent became terminal.');
    }

    if (verifiedContacts > 0) {
      await updateSearchRun(searchRunId, { status: 'CONTACTS_VERIFIED' });
      await updateContactStep(missionId, {
        status: 'SUCCESS',
        progress: 100,
        activity: `All ${agentSummary.total} assigned agent(s) reached 100%. ${verifiedContacts} verified public contact(s) are ready for operator outreach review.`,
        summary: {
          search_run_id: searchRunId,
          attempt_number: attemptNumber,
          assigned_agents: agentSummary.total,
          completed_agents: agentSummary.completed,
          verified_contacts: verifiedContacts,
          failed_agents: agentSummary.failed,
          not_found_agents: agentSummary.not_found,
          qualification,
        },
      });
      await recordEvent(missionId, 'CONTACT_DISCOVERY_COMPLETED', 'Stage 06 five-agent website/contact discovery completed.', {
        search_run_id: searchRunId,
        attempt_number: attemptNumber,
        agent_summary: agentSummary,
        verified_contacts: verifiedContacts,
      });
    } else {
      await updateSearchRun(searchRunId, { status: 'CONTACT_RETRY_REQUIRED' });
      await updateContactStep(missionId, {
        status: 'FAILED',
        progress: 100,
        activity: `All ${agentSummary.total} assigned agent(s) reached 100%, but no verified public email was found. Stage 06 requires operator retry or a different contractor selection.`,
        summary: {
          search_run_id: searchRunId,
          attempt_number: attemptNumber,
          assigned_agents: agentSummary.total,
          completed_agents: agentSummary.completed,
          verified_contacts: 0,
          failed_agents: agentSummary.failed,
          not_found_agents: agentSummary.not_found,
          qualification,
        },
        errorCode: 'NO_VERIFIED_CONTACTS',
        errorMessage: 'All assigned research agents completed, but no verified public email was located. No address was guessed.',
      });
      await recordEvent(missionId, 'CONTACT_DISCOVERY_RETRY_REQUIRED', 'Stage 06 research completed without a verified public email.', {
        search_run_id: searchRunId,
        attempt_number: attemptNumber,
        agent_summary: agentSummary,
      });
    }

    return { statusCode: 200, body: '' };
  } catch (error) {
    console.error('[ngcc-ops-contact-discovery-background]', error);
    try {
      await updateContactStep(missionId, {
        status: 'FAILED',
        progress: 100,
        activity: 'Stage 06 background execution failed during reconciliation.',
        errorCode: 'BACKGROUND_EXECUTION_FAILED',
        errorMessage: String(error?.message || error),
      });
    } catch (persistError) {
      console.error('[ngcc-ops-contact-discovery-background:persist-failure]', persistError);
    }
    return { statusCode: 500, body: '' };
  }
};
