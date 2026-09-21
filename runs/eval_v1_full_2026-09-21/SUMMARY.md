# Eval v1 results

Origin: http://127.0.0.1:3000
Set: tests/eval_set_v1.json (109 items, commit 929663d)
Judge: gpt-5.6-sol (different from Terra/Luna)

Run 1 drove every item through live `/api/session/start` + ingest + state. No application code was changed.
The last 14 items (`p10a`–`p10c`, `m01`–`m11`) hit `TypeError: fetch failed` after the Next.js dev server approached its memory threshold and Fast-Refreshed. Fixtures were restored (hashes matched baseline). Those 14 were re-run; combined substitutes only those ids.

| run | pass | total | rate | unexplained fails | known-issue fails | system errors |
|---|---:|---:|---:|---:|---:|---:|
| 1 raw (109) | 70 | 109 | 64.2% | 28 | 11 | 14 |
| 1b retry fetch-failed (14) | 9 | 14 | 64.3% | 4 | 1 | 0 |
| 1 combined after retry | 79 | 109 | 72.5% | 21 | 9 | 0 |

## Combined by group

| group | pass | total | rate |
|---|---:|---:|---:|
| 1_answers | 24 | 36 | 66.7% |
| 2_next_best_action | 10 | 19 | 52.6% |
| 3_must_never | 10 | 13 | 76.9% |
| 4_paraphrase | 29 | 30 | 96.7% |
| 5_change_the_data | 6 | 11 | 54.5% |

Combined failed ids: a04, a07, a08, a09, b05, b07, c03, c06, d02, d03, e04, e06, n03, n08, n09, n11, n13, n14, n15, n18, n19, x06, x08, x09, p04b, m02, m03, m05, m08, m10

Files: `run_01/` (raw), `retry_fetch/` (14-item rerun), `combined_summary.json`, `combined_results.json`.
