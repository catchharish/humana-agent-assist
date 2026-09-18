# Tier 2 evidence — live T01×2 + six replays 18 Sep 2026 (`:3004`)

Fresh `npx next dev --port 3004`. Stale :3000/:3001/:3003 must not be used for proof (`originUp()` can hang on a dead server).

## T01 twice (`ORIGIN=http://localhost:3004 RUN_T01=1 npx vitest run tests/t01_main.test.ts`)

| Run | Record | Result |
|---|---|---|
| T01-I | `runs/7ec51570-d19f-45b2-a15f-8452f8c10364` | pass (~37s) |
| T01-J | `runs/5ce74828-19d2-4a60-9ac2-852a66fa162b` | pass (~26s) |

Rail both: greeting `exact_timely`; pricing `late_finding` / **Delivered correctly, but late.**; closing `exact_timely`.

## Interactive T01 (C06)

`runs/10bc0f4b-500e-4872-b60b-a7477830ec48.jsonl` on `:3004`. Presenter Resume clicks. Mint/submit after coverage pause (late vs enrollment pause). Disposition Confirm required. See `tests/c06_checklist.md` — due-now Now-copy item left unticked.

## Six replays (`ORIGIN=http://localhost:3004 npx vitest run tests/replays.test.ts`)

Passed (~34s): T02A `79a3bd6d…`, T03A `60b3f7df…`, T03B `cc643f3f…`, T04B `66aa84f1…`, T06A `4a7c2a0a…`, T08B `cc93a299…`.

UI sample: landing **Replay T02A** showed T02A pause then “Pretty nice weather this morning…”.

## Timing honesty

Injected SEARCH delay on historical still misses the 5s target when it misses. Do not relabel. Clock remains ingest `clientT` / driver time, not luna arrival.

Prior `:3003` pack (T01-G/H, luna medians) is superseded for “demo proven” by this `:3004` set.
