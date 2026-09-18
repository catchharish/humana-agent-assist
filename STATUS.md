# STATUS

**Milestone:** M3. Tier 2 not accepted until you review this integrity re-run. Evidence: `runs/TIER2_EVIDENCE.md`.
**Last updated:** 18 Sep 2026

## Works
- §21.5 readback re-fire fixed: after exact DEMO-PRICING-v1 delivery, later triggers are logged suppressed; rail stays **Delivered correctly, but late.** C01 covers it.
- Scenario facts pulled out of copilot fallbacks/prompts/regex/default query/T06A copilot branch. T04B delay is the quotes mock; T01 2800 ms is start `injectedDelayMs`; T06A no-offer is the driver.
- SSE for the live page. Stage-1 nudge paint ~8–11 ms on T01-C/D (was ~1.9 s). Prefetch after VALID auth. FAST90 from governed text, no terra.
- Fresh T01-C `6863e0f3-…` and T01-D `9dcdfb2c-…` on `:3002`. Six replays passed. C05 live grader 4/4.
- Public GitHub repo: https://github.com/catchharish/humana-agent-assist (`.env` not included).

## Broken / incomplete
- Remaining paint misses logged honestly (FAST90/quotes still wait on luna need-id; historical with 2800 ms injected still misses 5s on both runs; wrap miss on T01-D). Targets not changed.
- Stretch/QA off. Tier 3 not built.

## Next three tasks
1. You accept or reject this integrity pack.
2. Optional: cut remaining luna wait on structured/FAST90 now that records are prefetched.
3. Present from `SUBMISSION.md` + this evidence file.

## Open questions for Harish
- Accept remaining 2s/5s/8s misses as recorded?
