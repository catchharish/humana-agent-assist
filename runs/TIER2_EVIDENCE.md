# Tier 2 evidence pack — integrity re-run 18 Sep 2026

Old records kept: `07f22fe4-…`, `e31b4478-…`, failed T04B `ab55cd2f-…`. This file now describes the **post-BATCH-A/B** runs.

## Verdict on the prior pack

The enrollment-readback re-fire that overwrote `pricingNote` was a **§21.5 hard failure**. It is treated as found then fixed: after exact qualifying DEMO-PRICING-v1 delivery, later triggers are logged (`suppressed: true`) and do not change state, nudge, or note.

## 2. Two fresh T01 runs (`next dev --port 3002`)

| Run | Record | Result |
|---|---|---|
| T01-C | `runs/6863e0f3-e8cf-40f8-9c53-3f6f537b9328.jsonl` + `.evidence.json` | Vitest pass ~79s |
| T01-D | `runs/9dcdfb2c-17e1-4f33-b600-596baa7235aa.jsonl` + `.evidence.json` | Vitest pass ~71s |

**Final rail (both):** greeting `exact_timely`; pricing `late_finding` with note **Delivered correctly, but late.**; closing `exact_timely` after one uncertain reread. S=2 F=1 recovered U=0 N=3.

Enrollment `scopeOk=true`. Readback re-fire is logged and **suppressed** (does not alter the rail).

## 1. Timing table (event-to-client-paint from jsonl)

Targets unchanged: 1 / 2 / 5 / 8 s. Misses are misses.

Live UI transport: **SSE** `GET /api/session/events` (replaced 400 ms polling). Driver paint is still ingest-return → rAF → `/api/session/paint`.

### T01-C `6863e0f3-…`

| Item | Event | Target | Measured | Result |
|---|---|---|---|---|
| Greeting | `e-greet-corrected` | 1000 | 9 | PASS |
| Stage-1 classification | `e-price-miss` | 1000 | **0 ms** | PASS |
| Stage-1 to client paint | `e-price-miss` | 1000 | **8 ms** | PASS |
| Existing refill (prefetch) | `e-rx-final` | 2000 | 2048 | **MISS** |
| Fresh status (prefetch) | `e-interrupt-final` | 2000 | 2128 | **MISS** |
| FAST90 (prefetch, no terra) | `e-90day` | 2000 | 4814 | **MISS** (paint still includes luna need-id) |
| Quotes | `e-yes-compare` | 2000 | 4194 | **MISS** |
| Historical (injected 2800) | `e-hist-final` | 5000 | 7823 | **MISS** |
| Historical without injected delay | (7823 − 2800) | 5000 | 5023 | **MISS** |
| Historical recheck (no 2800) | `e-return-met` | 5000 | 4251 | PASS |
| Wrap | `wrap-generated` | 5000 | 3513 | PASS |

Router historical compose: 4445 ms of which **2800 injected** (1645 uninjected). Recheck did not inject 2800.

### T01-D `9dcdfb2c-…`

| Item | Event | Target | Measured | Result |
|---|---|---|---|---|
| Greeting | `e-greet-corrected` | 1000 | 7 | PASS |
| Stage-1 classification | `e-price-miss` | 1000 | **0 ms** | PASS |
| Stage-1 to client paint | `e-price-miss` | 1000 | **11 ms** | PASS |
| Existing refill | `e-rx-final` | 2000 | 1555 | PASS |
| Fresh status | `e-interrupt-final` | 2000 | 1924 | PASS |
| FAST90 | `e-90day` | 2000 | 3848 | **MISS** |
| Quotes | `e-yes-compare` | 2000 | 4520 | **MISS** |
| Historical (injected 2800) | `e-hist-final` | 5000 | 5707 | **MISS** |
| Historical without injected delay | (5707 − 2800) | 5000 | 2907 | PASS |
| Historical recheck (no 2800) | `e-return-met` | 5000 | 3806 | PASS |
| Wrap | `wrap-generated` | 5000 | 10339 | **MISS** |

Router historical compose: 3179 ms of which **2800 injected** (379 uninjected).

## 3. C05 on generated outputs

`C05_EVIDENCE_IDS=6863e0f3-…,9dcdfb2c-… npx vitest run tests/c05_live.test.ts` — **4/4 passed** (code grader, not a model).

## 4. Failed T04B record (kept)

`runs/ab55cd2f-124e-40e6-973f-01154207b2ae.jsonl`. This re-run's T04B vitest **passed**.

## 5. Phrase / scenario search (`app/` + `lib/`, excluding `tests/` + `fixtures/`)

Unjustified product-code hits from the prior pack: **removed** (repetition rule; quote fallback from REST rows; prompts rules+evidence JSON only; `promoteHistorical` from need `queryText`/`sourceUtteranceId`; no router default query; few-shots rewritten; T06A/T04B/2800 out of `lib/copilot.ts`).

Remaining hits and why they stay:

| Location | Hit | Why it is not an unjustified scenario key |
|---|---|---|
| `lib/copy.ts` | §15 enrollment readback / outcome templates (metformin, Lakeview, Jardiance) | Governed script text, not a branch |
| `lib/interpret.ts` | JSON enum `lakeview` / `oak-street` / `centerwell` | Simulated REST pharmacy ids, not test utterances |
| `lib/triggers.ts` | amount-word list includes `fifteen` | Generic detector |
| `app/page.tsx` | stream picker `t01_m2a`…; human edit medications | Demo harness / human control |
| `app/api/simulated/.../pharmacy-network` | `overlay === "T06A"` | Mock omit DEMO-NET0818 |
| `app/api/simulated/.../quotes` | `overlay === "T04B"` + lakeview delay 2000 | Mock handler delay via overlay |
| `tests/driver.ts` | T06A dismisses optional offer; T01 `injectedDelayMs=2800` | Test driver / start body, not copilot |

No `beat === n` conditionals. No dollar amounts in copilot fallbacks.

## 6. Per-call counters (T01-C / T01-D)

| Counter | T01-C | T01-D |
|---|---|---|
| Pricing triggers **shown** (unsuppressed) | 1 (`e-price-miss`) | 1 |
| Pricing triggers **logged suppressed** | 1 (`e-readback`, §21.5 fix) | 1 |
| Closing rereads requested / completed | 1 / 1 | 1 / 1 |
| Miss transcript → exact reading (`tEvent`) | 218 ms | 339 ms |

## 7. Six replays

T02A, T03A, T03B, T04B, T06A, T08B passed on `:3002` (T02A re-run after awaiting non-compliance interpret so COMPLETED_SERVICING is recommended).

## Prior pack (unchanged files)

See git history of this file from earlier today for T01-A/B timings. Those runs still exist on disk.
