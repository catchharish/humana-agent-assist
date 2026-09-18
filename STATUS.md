# STATUS

**Milestone:** M3. Freeze except rehearsal defects.
**Last updated:** 18 Sep 2026

## Works
- Per-field luna apply. T01 `00d1a1b6-…` pass. Trigger always applies (priority + hedge kept).
- Stale discard T01 after: callType 2 / focus 4 / consent 4 / trigger 0. Before `570c747a-…`: 0.
- Failed compact T01 `f65459fe-…` kept. Consent/C01/stale tests pass.

## Broken / incomplete
- C01 priority max **1176 MISS** (2/20). Interpret **1160 / 1555 MISS** vs 1s.
- Historical +2800 SEARCH still **MISS** 5s.

## Next three tasks
1. Wait for code review; no further changes unless asked.
2. Present from `SUBMISSION.md` + `runs/TIER2_EVIDENCE.md`.
3. Rehearsal only if a defect is found.

## Open questions for Harish
- Keep trigger priority given 2× token price and 2/20 still over 1s?
