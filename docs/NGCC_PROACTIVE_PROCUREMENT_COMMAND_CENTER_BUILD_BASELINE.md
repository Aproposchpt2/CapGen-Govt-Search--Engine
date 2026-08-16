# NGCC Proactive Federal Procurement Engine — Controlled Engineering Baseline

Status: AUTHORIZED FOR ENGINEERING
Date: 2026-08-11
Application: National Government Contract Center (NGCC)
Production: https://ngcc.aproposgroupllc.com

## Mission

Convert NGCC's existing SAM.gov opportunity, registered-entity, matching, and outreach assets into a contract-first, task-execution-oriented Executive Command Center using the proven BusinessContracts mission pattern as the structural foundation.

## Governing architecture

SAM.gov remains authoritative for federal opportunity and registered-entity data. APROPOS persistence is operational state, not a replacement SAM database.

One contract = one procurement mission.

Only one execution stage may be active at a time. A successful stage unlocks its immediate successor; it does not execute downstream stages automatically.

## Mission stages

1. OPPORTUNITY_DISCOVERY — select one actionable open federal opportunity.
2. CONTRACT_DNA — construct evidence-backed procurement requirements, including SAM-assigned NAICS, requirements-derived primary/related NAICS, set-aside/competition, PSC, capability language, supplier role, geography, deadlines, and hard constraints.
3. BUSINESS_SEARCH_DNA — convert Contract DNA into explicit registered-contractor retrieval and qualification criteria.
4. SAM_CONTRACTOR_DISCOVERY — execute live SAM Entity Management search using the approved Business Search DNA.
5. CONTRACTOR_QUALIFICATION — hard-filter and explainably score candidates using eligibility, NAICS/related NAICS, capability, supplier role, PSC, semantic evidence, geography/capacity, and contract-specific constraints.
6. OPERATOR_REVIEW — operator accepts, holds, or rejects candidates. AI does not autonomously authorize outreach.
7. BUSINESS_OUTREACH — use existing controlled outreach infrastructure and suppression/unsubscribe rules.
8. RESPONSE_CONTRACT_ASSISTANCE — track responses and route interested businesses into Analyze Fit / Contract Assistance.

## Execution-state contract

Every substantive stage exposes backend-owned state:

- READY
- RUNNING
- SUCCESS
- ZERO_RESULT
- FAILED
- STALLED

Required execution evidence:

- mission_id
- step_code
- status
- progress_percentage
- current_activity
- started_at
- last_heartbeat_at
- completed_at
- records_examined
- records_accepted
- records_rejected
- output_summary
- evidence
- error_code
- error_message
- retry_count

The browser must never manufacture elapsed-time progress.

## Reuse requirements

Do not rebuild working capabilities when they satisfy the new contract. Reuse and adapt:

- ngcc-ops-sam-opportunities.js
- ngcc-sam-entity-search.js
- ngcc-ops-derive-naics.js
- existing SAM active-contractor import capability
- existing NGCC operator authentication
- existing contact discovery and outreach infrastructure
- existing unsubscribe/suppression behavior
- AOIE Federal Matcher components after validation

The current ops-dashboard.html is not the new interaction-design baseline. The BusinessContracts Executive Command Center task/mission model is the structural baseline.

## Approved derived-NAICS search enhancement

The existing requirements-based NAICS derivation capability is a permanent component of Stage 02 CONTRACT_DNA.

Governing rule: the derived classification expands and refines contractor discovery; it does not silently overwrite SAM.gov source evidence.

Contract DNA must preserve separately:

- sam_assigned_naics
- derived_primary_naics
- derived_related_naics
- sam_naics_confirmed
- derivation_rationale
- requirements_evidence_used

Search construction must use:

1. SAM-assigned NAICS as authoritative source evidence.
2. Derived primary NAICS as an additional/refined retrieval path.
3. Derived related NAICS as controlled search expansion.
4. Capability language, PSC, supplier role, set-aside eligibility, and hard constraints for downstream qualification.

When derived analysis disagrees with SAM's assigned NAICS, both values remain visible and auditable. No source classification is destroyed or replaced.

The resulting contractor population is a candidate pool only. A business must still pass eligibility and contract-specific qualification before operator review.

## Contract DNA minimum output

- SAM notice ID
- solicitation number
- agency
- title
- opportunity type
- posted date
- response deadline
- set-aside / competition classification
- eligible business classification
- primary requirement
- products/services
- required capabilities
- required experience/certifications
- supplier role
- place of performance
- SAM-assigned NAICS
- derived primary NAICS
- derived related NAICS
- SAM NAICS confirmed/corrected determination
- NAICS derivation rationale/evidence
- PSC
- procurement keywords/language
- mandatory requirements
- registration restrictions
- geographic restrictions
- manufacturer/supplier restrictions
- other hard constraints
- confidence and evidence

## Business Search DNA minimum output

Hard requirements:
- active SAM registration
- compatible set-aside/business classification where required
- no known hard-disqualifier
- registration validity appropriate to pursuit

Retrieval/qualification signals:
- SAM-assigned NAICS
- derived primary NAICS
- derived related NAICS
- capability terms
- PSC-derived capability concepts
- supplier role
- location criteria
- contract-specific constraints

## Candidate result contract

Each candidate must expose:

- ordinal candidate number (1..X)
- legal/business name
- UEI
- CAGE when available
- SAM registration status
- business classifications relevant to the procurement
- matched NAICS evidence, including which search path produced the candidate
- set-aside compatibility
- capability alignment
- supplier-role compatibility
- geography/capacity evidence when available
- hard-constraint determination
- overall fit score
- confidence
- positive evidence
- concerns/discrepancies
- contact status
- operator disposition
- outreach status

A SAM registration alone is not a qualification decision.

## Controlled implementation sequence

1. Reverse-engineer current NGCC operator functions and BusinessContracts mission implementation.
2. Define mission/step API contract and minimal operational persistence.
3. Build Contract DNA service by extending the existing requirements/NAICS derivation path rather than duplicating it, preserving SAM NAICS while adding derived primary/related NAICS evidence.
4. Build Business Search DNA service using the approved multi-path NAICS search model.
5. Wire live SAM contractor discovery to the approved DNA.
6. Integrate explainable candidate qualification using validated AOIE assets.
7. Build the Executive Command Center UI with server-authoritative monitoring.
8. Integrate existing outreach and response paths.
9. Execute static, functional, failure/retry, and production-readiness validation.
10. Present implementation evidence at the merge/production gate.

## Production governance

Engineering proceeds on a controlled feature branch. Existing production behavior is preserved during construction. Production merge/deployment is a separate validation gate.
