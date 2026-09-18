# STATUS

**Milestone:** M3. Freeze after this pass except rehearsal defects.
**Last updated:** 18 Sep 2026

## Works
- T01-G `29bec95e-…` and T01-H `1436b66c-…`. Scripted FAST90/quotes **code_rule** 14–26 ms. Paraphrases **luna** 1058 / 1685 ms.
- 90-day class + conservative consent set in `fixtures/utterance_rules.json`. Partials do not change display (`e-yes-partial` `displayChanged: false`).
- Luna compact enums; starts on partials. Warm 10-call median **1511 ms**, max **2134**.
- Six replays passed on `:3003`. Enrollment readback + doubled-word test unchanged.

## Broken / incomplete
- Historical with 2800 ms injected still **MISS** 5s (7523 / 6985).
- Luna median still slower than the old ~899 ms 16-token warmup.
- Stretch/QA off. Tier 3 not built.

## Next three tasks
1. Rehearsal; only fix defects you find.
2. Present from `SUBMISSION.md` + `runs/TIER2_EVIDENCE.md`.
3. Do not add features.

## Open questions for Harish
- Accept remaining historical injected-delay misses and the 1511 ms luna median?
