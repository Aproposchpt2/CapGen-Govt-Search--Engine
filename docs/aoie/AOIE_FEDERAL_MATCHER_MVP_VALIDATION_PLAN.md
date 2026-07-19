# AOIE Federal Matcher MVP Validation Plan

## Controlled Acceptance Cases

1. **Cross-NAICS semiconductor supply**
   - Contractor: Wholesale Automation and Controls LLC
   - Opportunity: SPE7M526Q0729
   - Expected: Strong Match; distributor/wholesaler reasoning present.

2. **False-positive suppression**
   - Opportunity: BRUSH CHIPPER
   - Expected: no semiconductor concept.

3. **ASIC opportunity**
   - Opportunity: N00019-25-RFPREQ-TPM265-0465
   - Expected: candidate retrieved; Good Match or higher; manufacturer/technical qualifications remain subject to verification.

4. **Semiconductor-process equipment**
   - Opportunity: semiconductor-process compatible dry pumps
   - Expected: not automatically Strong Match solely because “semiconductor” appears.

5. **Unrelated service**
   - Opportunity: janitorial/custodial services
   - Expected: Not Recommended.

6. **Expired opportunity**
   - Expected: hard disqualifier `EXPIRED` and fit score 0.

7. **Manufacturer-only condition**
   - Distributor-only contractor profile
   - Expected: hard disqualifier `MANUFACTURER_ONLY_MISMATCH`.

## Required Evidence

- GitHub Actions fixture-suite output
- Engine, ontology, and scoring versions
- Control-case score and explanation
- False-positive results
- Runtime latency for candidate retrieval and scoring
- No public exposure of the internal shadow endpoint
- No modification of approved NGCC UI or legacy matcher

## Promotion Gates

The MVP may be recommended for production shadow mode only when:

- all fixture tests pass;
- internal endpoint authentication is confirmed;
- live-data results are reviewed;
- no expired opportunities are returned as recommended;
- no brush-chipper false positive is generated;
- the public dashboard remains unchanged;
- Project Owner provides separate authorization.
