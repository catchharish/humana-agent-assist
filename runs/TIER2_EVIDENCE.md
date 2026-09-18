# Tier 2 evidence — generalized utterance rules 18 Sep 2026

Prior packs kept. Clock is still ingest `clientT` / driver `Date.now()` before the transcript POST, not luna arrival.

## T01 twice (`:3003`)

| Run | Record | Vitest |
|---|---|---|
| T01-G | `runs/29bec95e-6424-4f9f-96df-3ae4950b28b8` | pass ~18s |
| T01-H | `runs/1436b66c-9f95-4c52-9a94-fc3e30f8aaf9` | pass ~19s |

Rail both: greeting `exact_timely`; pricing `late_finding` / **Delivered correctly, but late.**; closing `exact_timely`.

## Partial at first compare-yes (`e-yes-partial` → `e-yes-compare`)

T01-G jsonl:

```
governed_utterance e-yes-partial stability=partial comparison=wait displayChanged=false nowTitle="Clarify comparison interest"
event_to_client_paint e-yes-partial paintMs=8
luna_interpret e-yes-partial ms=1580 cc=none  (started; did not change display)
transcript e-yes-compare "Yes, please compare both."
need_path prospective_comparison code_rule
```

The clarification title was already on screen from the **final** hedge. The partial `yes` did not fire a new clarification card (`displayChanged: false`). Quotes attach on the final.

## Timing (event-to-client-paint) with path

| Item | Target | Path | T01-G | T01-H | Isolated paraphrase |
|---|---|---|---|---|---|
| Greeting | 1000 | code | 9 PASS | 22 PASS | — |
| Stage-1 `e-price-miss` | 1000 | code | 10 PASS | 7 PASS | — |
| FAST90 `e-90day` scripted | 2000 | **code_rule** | **14 PASS** | **17 PASS** | 14 PASS |
| FAST90 paraphrase (“Could you go over that longer fill option you brought up?”) | 2000 | **luna** | — | — | **1058 PASS** |
| Quotes `e-yes-compare` scripted | 2000 | **code_rule** | **24 PASS** | **26 PASS** | 326 PASS |
| Quotes paraphrase (“Yes I want you to compare both pharmacies.”) | 2000 | **luna** | — | — | **1685 PASS** |
| Historical +2800 | 5000 | luna+SEARCH | 7523 **MISS** | 6985 **MISS** | — |

Misses are misses. Paraphrase runs: `tests/path_measure.test.ts` on `:3003`.

## Luna compact JSON (warm, 10 sequential interpret calls, one discarded)

Samples ms: 2134, 1598, 1119, 1487, 1074, 1440, 1434, 1536, 1658, 2129.

**Median 1511 ms. Max 2134 ms.** Still slower than the earlier ~899 ms 16-token warmup; this is the real compact classifier (`max_output_tokens` 128, enum codes only). Recorded honestly. Luna starts on partials and does not apply display/consent until final.

## Six replays (`:3003`, after compact-parse fix)

T02A, T03A, T03B, T04B, T06A, T08B passed (`tests/replays.test.ts` ~22s).
