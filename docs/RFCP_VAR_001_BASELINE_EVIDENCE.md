# RFCP-VAR-001 baseline evidence

Captured 2026-08-22 before remediation.

| Evidence | Identifier |
|---|---|
| RFCP-VAR-001 tested commit | `4d84319d39b65440d1529b594ac0f10d7068cc4b` |
| RFCP-VAR-001 tested Netlify deploy | `6a890535dd881e00078e5dc7` |
| Production commit at remediation start | `e96bb6b0f700d5938b98f5b24e8cb48731babd02` |
| Production Netlify deploy at remediation start | `6a898b9632b0b40008c2c3ba` |
| Netlify site | `national-gov-contract-center` (retained technical alias) |
| Supabase project | `judislfknmhofcgzyozc` |

The starting production commit was a direct successor to the report's tested commit and contained the approved homepage hero revision. The failed-item remediation branch starts from that current production commit. Production was not changed by this work.

Initial repository command: `node --test tests/*.test.js`.

Initial result: 19 tests, 13 passed, 6 failed. The six failures corresponded to the AOIE ASIC threshold, missing tablet generated patch, controlled-delivery expectation, operator IT NAICS preset, obsolete Marketplace claim routing, and obsolete CDC Contract Assistance closeout routing documented by RFCP-VAR-001.
