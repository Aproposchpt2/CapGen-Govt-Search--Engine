# APROPOS Analyze Fit Executive Report Standard

## Status

**Approved standard template** for all CapGen Analyze Fit reports.

The authoritative runtime template is:

- `analyze-fit.html`

This document defines the report structure, presentation rules, data contract, and quality controls that future AI-agent and developer changes must preserve.

## Executive Purpose

Every Analyze Fit report must answer one management question:

> **Should this business pursue this opportunity?**

The report is executive decision support. It is not a proposal, capture plan, capability statement, or proposal-development package.

## Required Report Sequence

1. Premium Cover and Executive Verdict
2. Executive Decision Summary
3. Strategic Alignment
4. Eligibility Review
5. Capability Evidence Ledger
6. Competitive Position
7. Risk Command Center
8. Executive Observations
9. Bid / No-Bid Decision
10. Executive Action Plan
11. Management Authorization & Source Notes

## Approved Brand Standard

- APROPOS GROUP LLC premium navy-and-gold identity
- Approved APROPOS monogram logo, proportionally resized without distortion
- Deep navy, metallic-gold, white, and restrained status colors
- Executive typography with strong hierarchy and generous spacing
- Letter-size portrait PDF output
- `CONFIDENTIAL` treatment and APROPOS attribution on every page

## Readability Standard

Detailed content must remain comfortably readable in both browser and exported PDF formats.

- Narrative text: approximately 0.74–0.88 rem on screen, equivalent to a professional 10–11 point print range
- Table text: no smaller than approximately 0.66 rem except controlled labels and footer metadata
- Section headers must clearly separate decision domains
- No clipped text, overlapping elements, orphaned headings, or content extending beyond the printable page
- Long AI-generated content must be safely summarized or clipped by deterministic presentation rules

## Existing Analyze Fit Data Contract

The premium renderer consumes the current Analyze Fit response without changing scoring or model behavior.

### Stage 1

- `opportunity_summary`
- `match.naics_match`
- `match.naics_detail`
- `match.set_aside_eligible`
- `match.set_aside_detail`
- `match.capability_alignment`
- `match.capability_detail`
- `recommendation`
- `fit_score`
- `rationale`
- `conditions`

### Stage 2

- `required_work`
- `staffing_delivery`
- `documents_needed`
- `proposal_checklist`
- `draft_technical_approach`
- `pricing_considerations`
- `questions_for_co`

The renderer may derive presentation-only indicators and executive labels from these fields. It must not silently alter the underlying recommendation or fit score.

## Decision Integrity Rules

- Preserve the AI-generated recommendation and fit score as source values.
- Clearly distinguish verified evidence, reported information, assumptions, unknowns, and required validation.
- Missing information must be identified as unknown or not provided; it must never be invented.
- Mandatory eligibility, licensing, registration, security, staffing, and delivery gates must remain visible.
- A conditional recommendation must not be presented as unconditional authorization.
- A failed or unavailable Stage 2 response must not prevent a valid Stage 1 executive report from rendering.

## Required Quality Assurance

Before changes are approved:

1. Validate JavaScript syntax.
2. Render representative BID, CONDITIONAL, and NO_BID cases.
3. Test long opportunity titles, long narrative responses, and populated tables.
4. Export to Letter-size PDF.
5. Confirm the report produces exactly 11 controlled pages.
6. Confirm every page has zero overflow, clipping, or overlap.
7. Confirm browser, mobile, and print readability.
8. Confirm Analyze Fit authentication, polling, caching, and data retrieval remain operational.

## Change Control

Any future modification affecting report order, branding, typography, decision logic, scoring display, data fields, or print pagination requires explicit APROPOS GROUP LLC approval before production deployment.
