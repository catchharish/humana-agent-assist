# STATUS

**Milestone:** M3. Due-now wording owns Now (§14 / D11). Interactive T01 on `:3005` shows pricing sentence on Now with quotes demoted in the drawer.
**Last updated:** 18 Sep 2026

## Works
- DEMO-PRICING-v1 is Pending later once the comparison is offered; Due now only on comparison `absolute_yes` or a spoken prospective estimate.
- `e-yes-compare` (code or luna) clears Clarify and puts the registry sentence on Now. Quotes stay in Context as ready/demoted with amounts.
- Unit tests `tests/pricing_now.test.ts` a/b/c (b waits 1.5s). Interactive proof: `runs/b3863f9e-…` pause “Six quotes loaded” `nowTitle=Pricing statement due now`.
- C06 due-now item ticked from that walk.

## Broken / incomplete
- Automated T01×2 and six replays not re-run on `:3005` after this patch (last live pack was `:3004`).

## Next three tasks
1. Re-run T01 twice + six replays on a fresh port if you want the pack on this patch.
2. Present against a fresh `next dev` port; stale :3000 can hang vitest.
3. Keep jsonl under `runs/` for the presenter walk.

## Open questions for Harish
- None. Due-now vs clarify is implemented as you specified.
