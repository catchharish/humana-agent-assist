# STATUS

**Milestone:** M4. General citations/NBA/facts pass (20 Sep). Overlay names out of product conditionals.
**Last updated:** 20 Sep 2026

## Works
- Six replays **6/6** (T06A via unmatched classifications → “cause is not confirmed”, not a T06A branch).
- Facts panel = member records; preferred/standard only from dated classification rows.
- After auth, Need/step is **Listening** until a need is detected (no refill-on-auth default).
- NBA hard stops are seven; `unconfirmed_fact` logs the token. Playbook text covers refill-only / unconfirmed cause.
- Per-statement support check typically **0.1–3 ms** (`support_check.ms`).

## Broken / incomplete
- T01 this run: failed waiting for coverage (luna interpret empty; no coverage cue fallback). An earlier run in this pass completed after Listening; **T01 does not depend on a refill-on-auth default.**
- Chain last file `runs/chain_eval_1789865125185.json`: **5/10**, 0 over 8s (prior `1789863778279.json` was **9/10**, c08 Ozempic wipe). Misses logged, not averaged.
- `tests/not_canned.test.ts`: 1/3 (same-member hist vs refill bodies matched claim dump; M004 model `none` not `other_plan_cost_explain`).
- `tests/nba_members.test.ts`: Harry suggestion not pending (7th stop or model none).

## Next three tasks
1. Re-run T01 / chain / not-canned when Luna is not empty/429.
2. Item 6 full T01 screenshot set with demo details off (idle screenshot taken; pause-by-pause not completed this run).
3. Freeze / SUBMISSION only if Harish asks.

## Open questions for Harish
- None.
