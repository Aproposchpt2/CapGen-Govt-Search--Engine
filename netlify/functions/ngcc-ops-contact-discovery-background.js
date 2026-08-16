'use strict';

const { opsGuard } = require('./lib/ngcc-ops');
const {
  discoverPublicContact,
  mergeCapabilityVerifications,
} = require('./lib/ngcc-contact-discovery');
const {
  listCandidates,
  listContactAgents,
  updateAgent,
  updateCandidateContact,
  summarizeAgents,
  updateSearchRun,
  recordEvent,
  nowIso,
} = require('./lib/ngcc-contractor-store');
const {
  researchQueueSummary,
  updateResearchStep,
} = require('./lib/ngcc-contact-research-queue');

const MAX_RESEARCH_ATTEMPTS = 3;
const RESEARCH_TIMEBOX_MS = 115000;

async function refreshProgress(missionId, searchRunId, attemptNumber) {
  const [agents, selected] = await Promise.all([
    listContactAgents({ searchRunId, attemptNumber }),
    listCandidates({ searchRunId, selectedOnly: true }),
  ]);
  const agentSummary = summarizeAgents(agents);
  const queueSummary = researchQueueSummary(selected);
  await updateResearchStep(missionId, {
    status: 'RUNNING',
    progress: agentSummary.progress_percentage,
    activity: `${queueSummary.completed}/${queueSummary.total} contractor candidate(s) researched · ${queueSummary.verified} verified public email(s) · ${agentSummary.completed}/${agentSummary.total} worker(s) terminal.`,
    summary: {
      search_run_id: searchRunId,
      attempt_number: attemptNumber,
      worker_count: agentSummary.total,
      completed_workers: agentSummary.completed,
      candidate_count: queueSummary.total,
      researched_candidates: queueSummary.completed,
      remaining_candidates: queueSummary.remaining,
      verified_contacts: queueSummary.verified,
      not_found_candidates: queueSummary.not_found,
      failed_candidates: queueSummary.failed,
    },
  });
  return { agents, agentSummary, selected, queueSummary };
}

async function researchCandidate(candidate, contractDna) {
  const businessName = candidate.business_name || candidate.businessName || 'Contractor';
  if (candidate.contact_verified === true && candidate.contact_email) {
    return {
      status: 'VERIFIED',
      business_name: businessName,
      skipped_existing_verified_contact: true,
    };
  }

  let result = null;
  let lastError = null;
  for (let pass = 1; pass <= MAX_RESEARCH_ATTEMPTS; pass += 1) {
    try {
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
    return { status: 'FAILED', business_name: businessName, error: message };
  }

  result.capability_verification = mergeCapabilityVerifications(
    candidate.capability_verification,
    result.capability_verification,
    candidate
  ) || candidate.capability_verification || {};
  result.research_status = result.contact_status === 'VERIFIED' ? 'SUCCESS' : 'NOT_FOUND';
  const persisted = await updateCandidateContact(candidate.candidate_id, result);
  return {
    status: persisted?.contact_verified ? 'VERIFIED' : result.contact_status === 'VERIFIED' ? 'VERIFIED' : 'NOT_FOUND',
    business_name: businessName,
    official_website_url: persisted?.official_website_url || result.official_website_url || null,
    contact_email: persisted?.contact_email || null,
    contact_source_url: persisted?.contact_source_url || result.source_url || null,
  };
}

async function runResearchWorker({ agent, byId, contractDna, missionId, searchRunId, attemptNumber }) {
  const startingSummary = agent.result_summary && typeof agent.result_summary === 'object' ? agent.result_summary : {};
  const assignedIds = Array.isArray(startingSummary.assigned_candidate_ids) && startingSummary.assigned_candidate_ids.length
    ? startingSummary.assigned_candidate_ids
    : [agent.candidate_id].filter(Boolean);
  const total = assignedIds.length;
  let completed = 0;
  let verified = 0;
  let notFound = 0;
  let failed = 0;
  const completedCandidates = [];

  await updateAgent(agent.id, {
    status: 'RUNNING',
    progress_percentage: 0,
    current_activity: `Worker ${String(agent.agent_slot).padStart(2, '0')} started with ${total} contractor candidate(s).`,
    started_at: agent.started_at || nowIso(),
    last_heartbeat_at: nowIso(),
    error_message: null,
  });
  await refreshProgress(missionId, searchRunId, attemptNumber);

  for (const candidateId of assignedIds) {
    const candidate = byId.get(candidateId);
    if (!candidate) {
      failed += 1;
      completed += 1;
      completedCandidates.push({ candidate_id: candidateId, status: 'FAILED', business_name: 'Unavailable candidate record' });
      await updateAgent(agent.id, {
        progress_percentage: Math.round((completed / total) * 100),
        current_activity: `Worker ${String(agent.agent_slot).padStart(2, '0')} skipped an unavailable persisted contractor record.`,
        result_summary: {
          ...startingSummary,
          assigned_candidate_ids: assignedIds,
          assigned_count: total,
          completed_count: completed,
          verified_count: verified,
          not_found_count: notFound,
          failed_count: failed,
          completed_candidates: completedCandidates,
        },
        last_heartbeat_at: nowIso(),
      });
      await refreshProgress(missionId, searchRunId, attemptNumber);
      continue;
    }

    const businessName = candidate.business_name || candidate.businessName || 'Contractor';
    await updateAgent(agent.id, {
      candidate_id: candidate.candidate_id,
      status: 'RUNNING',
      progress_percentage: Math.round((completed / total) * 100),
      current_activity: `Researching ${businessName} · candidate ${completed + 1}/${total} assigned to this worker`,
      last_heartbeat_at: nowIso(),
    });
    await refreshProgress(missionId, searchRunId, attemptNumber);

    const outcome = await researchCandidate(candidate, contractDna);
    completed += 1;
    if (outcome.status === 'VERIFIED') verified += 1;
    else if (outcome.status === 'NOT_FOUND') notFound += 1;
    else failed += 1;
    completedCandidates.push({
      candidate_id: candidate.candidate_id,
      business_name: businessName,
      status: outcome.status,
      contact_email: outcome.contact_email || null,
      official_website_url: outcome.official_website_url || null,
    });

    await updateAgent(agent.id, {
      status: 'RUNNING',
      progress_percentage: Math.round((completed / total) * 100),
      current_activity: completed < total
        ? `Completed ${businessName}; moving to the next contractor (${completed}/${total}).`
        : `Completed final assigned contractor ${businessName}.`,
      result_summary: {
        ...startingSummary,
        assigned_candidate_ids: assignedIds,
        assigned_count: total,
        completed_count: completed,
        verified_count: verified,
        not_found_count: notFound,
        failed_count: failed,
        completed_candidates: completedCandidates,
      },
      last_heartbeat_at: nowIso(),
    });
    await refreshProgress(missionId, searchRunId, attemptNumber);
  }

  await updateAgent(agent.id, {
    status: 'SUCCESS',
    progress_percentage: 100,
    current_activity: `Worker complete · ${completed}/${total} contractor(s) researched · ${verified} verified public email(s).`,
    result_summary: {
      ...startingSummary,
      assigned_candidate_ids: assignedIds,
      assigned_count: total,
      completed_count: completed,
      verified_count: verified,
      not_found_count: notFound,
      failed_count: failed,
      completed_candidates: completedCandidates,
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

  if (!missionId || !searchRunId || !attemptNumber) {
    return { statusCode: 400, body: 'mission_id, search_run_id, and attempt_number are required.' };
  }

  try {
    const [agents, selected] = await Promise.all([
      listContactAgents({ searchRunId, attemptNumber }),
      listCandidates({ searchRunId, selectedOnly: true }),
    ]);
    if (!agents.length) throw new Error('No contractor-research worker assignments were found.');
    if (!selected.length) throw new Error('The contractor-research queue is empty.');
    const byId = new Map(selected.map(candidate => [candidate.candidate_id, candidate]));

    await Promise.all(agents.map(async agent => {
      try {
        await runResearchWorker({ agent, byId, contractDna, missionId, searchRunId, attemptNumber });
      } catch (error) {
        console.error(`[ngcc-research-worker:${agent.agent_slot}]`, error);
        await updateAgent(agent.id, {
          status: 'FAILED',
          progress_percentage: 100,
          current_activity: 'Research worker ended with a controlled execution failure.',
          error_message: String(error?.message || error),
          completed_at: nowIso(),
          last_heartbeat_at: nowIso(),
        });
        await refreshProgress(missionId, searchRunId, attemptNumber);
      }
    }));

    const final = await refreshProgress(missionId, searchRunId, attemptNumber);
    if (!final.agentSummary.all_terminal) {
      throw new Error('Research reconciliation was reached before every active worker became terminal.');
    }

    if (final.agentSummary.failed > 0) {
      await updateSearchRun(searchRunId, { status: 'RESEARCH_RETRY_REQUIRED' });
      await updateResearchStep(missionId, {
        status: 'FAILED',
        progress: 100,
        activity: `${final.agentSummary.failed} research worker(s) failed before the full contractor queue could be certified complete. Retry contractor research.`,
        summary: {
          search_run_id: searchRunId,
          attempt_number: attemptNumber,
          worker_count: final.agentSummary.total,
          completed_workers: final.agentSummary.completed,
          candidate_count: final.queueSummary.total,
          researched_candidates: final.queueSummary.completed,
          verified_contacts: final.queueSummary.verified,
          failed_candidates: final.queueSummary.failed,
        },
        errorCode: 'RESEARCH_WORKER_FAILURE',
        errorMessage: 'At least one contractor-research worker failed. Persisted candidate results were preserved.',
      });
      return { statusCode: 500, body: '' };
    }

    await updateSearchRun(searchRunId, { status: 'RESEARCH_COMPLETE' });
    await updateResearchStep(missionId, {
      status: 'SUCCESS',
      progress: 100,
      activity: `Research queue complete: ${final.queueSummary.completed}/${final.queueSummary.total} contractor candidate(s) processed and ${final.queueSummary.verified} verified public email(s) stored. Contractor Qualification is READY.`,
      summary: {
        search_run_id: searchRunId,
        attempt_number: attemptNumber,
        worker_count: final.agentSummary.total,
        completed_workers: final.agentSummary.completed,
        candidate_count: final.queueSummary.total,
        researched_candidates: final.queueSummary.completed,
        verified_contacts: final.queueSummary.verified,
        not_found_candidates: final.queueSummary.not_found,
        failed_candidates: final.queueSummary.failed,
      },
    });
    await recordEvent(missionId, 'CONTRACTOR_RESEARCH_COMPLETED', 'Five-worker contractor research queue completed.', {
      search_run_id: searchRunId,
      attempt_number: attemptNumber,
      agent_summary: final.agentSummary,
      queue_summary: final.queueSummary,
    });

    return { statusCode: 200, body: '' };
  } catch (error) {
    console.error('[ngcc-ops-contact-discovery-background]', error);
    try {
      await updateResearchStep(missionId, {
        status: 'FAILED',
        progress: 100,
        activity: 'Contractor research background execution failed during reconciliation.',
        errorCode: 'BACKGROUND_EXECUTION_FAILED',
        errorMessage: String(error?.message || error),
      });
    } catch (persistError) {
      console.error('[ngcc-ops-contact-discovery-background:persist-failure]', persistError);
    }
    return { statusCode: 500, body: '' };
  }
};
