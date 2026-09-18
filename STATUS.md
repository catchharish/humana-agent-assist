# STATUS

**Milestone:** M3. Freeze except rehearsal defects.
**Last updated:** 18 Sep 2026

## Works
- T01 `570c747a-…` 23.6s on `:3003`. Failed compact-output T01 kept `runs/f65459fe-8069-4cfc-9419-afdbab2e1dbf.jsonl`.
- Trigger-only `service_tier: priority` + hedge. 20 warm C01: **878 / 1176 ms, 2/20 over 1s**.
- `lunaSeq` discards stale interpret/trigger; driver waits throw on timeout.
- Consent / C01 / stale-apply unit tests pass.

## Broken / incomplete
- C01 priority max **1176 MISS** (2/20). Interpret still **1160 / 1555 MISS** vs 1s.
- Historical +2800 SEARCH still **MISS** 5s. Prompt cache unused (prefix < 1024).

## Next three tasks
1. Rehearsal; only fix defects you find.
2. Present from `SUBMISSION.md` + `runs/TIER2_EVIDENCE.md`.
3. Do not add features.

## Open questions for Harish
- Keep trigger priority given 2× token price and 2/20 still over 1s?
