# RFC Portal VAT Remediation 02

Certification program: `RFC-PORTAL-VATP-001`

## Purpose

Consolidate the customer-facing Nat-Corp / NGCC merger into one authoritative Registered Federal Contractors Portal workflow before production certification and sale-readiness review.

## Validated remediation

- Canonical customer dashboard: `/dashboard.html`.
- Returning Member Login converges on the canonical dashboard.
- `/apropos` and direct `/ag-dashboard.html` customer traffic redirect to `/dashboard.html`.
- Verified shared profile sessions can obtain an entitlement-neutral `portal_profile` server-side customer session.
- Federal and State matching use the same verified merged business profile.
- Federal Analyze Fit remains `$79.00` and retains its separate credit ledger / purchase gate.
- Analyze Fit browser report, orchestrator, background worker, and DOCX generation prefer the verified merged profile and retain legacy `demo_snapshots` fallback for existing customers.
- Customer-facing standalone Proposal Development framing is removed from the Analyze Fit report.
- State Analyze Fit is intentionally not fabricated; state results remain in the state-match workflow pending separate report-path validation.

## Validation evidence

PR: `#56` — RFC Portal VAT Remediation 02 — unify customer dashboard and Analyze Fit

Validated PR head: `e062bf5e0ce3b58322ca3ef75d71ccbebc700ec8`

Merge commit: `79ece92216b8ed8ba2335ef43926d14aa1d77208`

Deploy Preview: `6a82e0969dd7c00008966756`

Preview result: **READY**

- 86 serverless functions
- 2 edge functions
- 25 redirect rules processed successfully
- 6 header rules processed successfully
- 227 files secret-scanned
- 0 secret findings

## Certification status

Remediation Pass 02 is code-validated and merged. Production acceptance remains pending until the production Netlify deploy is verified on the merge commit or a descendant containing it.
