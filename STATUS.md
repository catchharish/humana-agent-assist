# STATUS

**Milestone:** M3. Review defects (F1–F35) patched; T01/C06 must be re-walked.
**Last updated:** 18 Sep 2026

## Works
- Consent: member+final only; enrollment bound to scopeKey + pending matching readback.
- Stage-1 amounts are currency-marked; comparatives load from the registry.
- Greeting/closing write-once after exact; paraphrase needs overlap.
- `showNow` due-now/nudge outranks answers. Fresh refill/coverage lookup; no evidence `??` literals.
- Greeting/closing/pricing stitch adjacent same-speaker finals of one reading (§12.4).
- Driver paint waits `lastAppliedEventId` (member finals wait interpret apply, not HTTP ack).
- Luna interpret: priority tier, prompt cache key, padded static prefix, early-stop on valid JSON.

## Broken / incomplete
- Interactive T01 + C06 re-tick not done. Live T01/replays not re-run in this session.

## Next three tasks
1. Interactive T01 walk; keep jsonl; re-tick `tests/c06_checklist.md`.
2. `RUN_T01=1` and the six replays against localhost.
3. Confirm T01 wrap contents, `deferred_valid`, and `recheck:true`.

## Open questions for Harish
- None on product behavior. C06 still needs your T01 presenter walk.
