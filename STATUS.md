# STATUS

**Milestone:** 109-item eval runner + first live run. **Last updated:** 21 Sep 2026, 00:15

## Works
- Standalone eval: `npx tsx scripts/eval_runner.ts` (or `npm run eval:v1`). Set is `tests/eval_set_v1.json` (109 items, commit 929663d). No application code changed.
- Drives live session start / greeting / auth / ingest / state. Scores regex + `gpt-5.6-sol` judge. Writes `runs/eval_v1_*`.
- First full run stored at `runs/eval_v1_full_2026-09-21/`.
- **After-call Quality Score (built and verified live 21 Sep).** Derived on read by `lib/qualityScore.ts` from `runs/<id>.jsonl`; renders as the first child of the Now card on **both** wrap and review. Each count is a button that expands to plain prose plus the run-log line behind it. Display only — no call-handling change.
- Verified on two members: Harry `t02a` gave "1 required statement · 1 read on time · 0 never corrected"; a Priya open call gave "2 required statements · 1 read on time · 1 never corrected" with the miss line "Closing statement — no nudge appeared, never read exactly · the check ran in code". Pricing was correctly excluded both times because its rule did not apply.

## Eval results (this run)
- **Run 1 raw:** 70/109 (**64.2%**). Last 14 items (`p10a`–`p10c`, `m01`–`m11`) were `fetch failed` after the Next.js dev server hit its memory threshold.
- **Retry of those 14:** 9/14 (**64.3%**). Fixtures restored (hashes match baseline).
- **Combined after retry:** **79/109 (72.5%)**. Groups: answers 24/36, NBA 10/19, must-never 10/13, paraphrase 29/30, change-the-data 6/11. 0 system errors after retry. 21 unexplained fails, 9 known-issue fails.
- Details: `SUMMARY.md`, `combined_summary.json`, `run_01/`, `retry_fetch/`.

## Tests after the Quality Score work
- T01 main call: passed once. Six replays: 6/6 on a clean rerun (`runs/quality_score_replays_rerun.txt`). `quality_score` + `exactness` unit suites: passed. `c01_disclosure`: 16/17, the one failure is the pre-existing stitching bug below.

## Still wrong
- Combined fails include multi-ask (a04), mixed retail (a07), timeline withhold (a08), 30-day fact (a09), several NBA cards, and data-change m02/m03/m05/m08/m10.
- `tests/c01_disclosure.test.ts` > "stitches adjacent same-speaker final segments of one reading" fails: greeting is `paraphrased`, expected `exact_timely`. **Pre-existing, not from the Quality Score work** — it fails identically with the new obligation logging neutralised, and `lib/exactness.ts` was last edited 20 Sep 21:36. Failed record kept at `runs/quality_score_suites.txt`.
- `runs/quality_score_suites.txt` is interleaved: two agents ran suites against the same dev server at once. The clean rerun is `runs/quality_score_replays_rerun.txt`.

## Next three tasks
1. Fix the c01 stitching regression in `lib/exactness.ts`.
2. Read combined eval fails if you want product fixes (not done this session).
3. Laptop-width visual vs Design.pdf.

## Open questions for Harish
- Four items still tagged `decision_needed` (n02, n06, n19, m03).
- Same T04B quote-invalidation question as before.
