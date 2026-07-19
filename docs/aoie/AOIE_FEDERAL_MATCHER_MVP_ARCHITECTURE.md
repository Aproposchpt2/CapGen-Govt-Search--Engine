# AOIE Federal Matcher MVP Architecture

## Status

Protected-branch implementation. Not authorized for production merge or public AOIE mode.

## Purpose

The MVP supplements exact-NAICS matching with capability, procurement-language, supplier-role, and related-industry reasoning. NAICS remains a strong signal but is not required for candidate retrieval.

## Components

1. `netlify/functions/lib/aoie-federal.js`
   - Versioned electronics ontology
   - Business capability expansion
   - Opportunity feature extraction
   - Hard constraints
   - Configurable hybrid scoring
   - Separate confidence result
   - Explainable match output

2. `netlify/functions/aoie-shadow-evaluate.js`
   - Protected internal endpoint
   - Requires `AOIE_INTERNAL_TOKEN`
   - Queries exact-NAICS and semantic candidates
   - Deduplicates by notice ID
   - Returns AOIE results without modifying the public dashboard

3. `tests/aoie-federal.test.js`
   - Cross-NAICS semiconductor positive fixture
   - Brush-chipper false-positive fixture
   - ASIC fixture
   - Semiconductor-process equipment fixture
   - Unrelated janitorial fixture
   - Expired-opportunity fixture
   - Manufacturer-only constraint fixture

## Versions

- Engine: `aoie-federal-mvp-1`
- Ontology: `federal-electronics-v1`
- Scoring: `federal-hybrid-v1`

## Initial Score Model

| Signal | Points |
|---|---:|
| Exact NAICS | 25 |
| Related NAICS | 15 |
| Capability/product alignment | 25 |
| Supplier-role compatibility | 10 |
| Semantic evidence | 10 |
| Set-aside compatibility | 5 |
| PSC alignment | 5 |
| Agency/market relevance | 3 |
| Geography/capacity | 2 |

## Safety Boundaries

- No public route is enabled without an internal token.
- No database schema change is required for this first executable prototype.
- No legacy matching code is removed.
- No approved UI is modified.
- Opportunity text is treated as untrusted data.
- Expired and confirmed manufacturer-only mismatches are hard-disqualified.

## Next Architecture Step

After fixture and live-data validation, add versioned persistence tables through a reviewed Supabase migration and connect shadow execution to the existing profile-generation pipeline without affecting the displayed legacy dashboard.
