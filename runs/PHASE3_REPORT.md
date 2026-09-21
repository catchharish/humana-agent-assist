# Phase 3 report — 20 Sep 2026

**Later same day:** Phase 4 wrap is [`runs/PHASE4_CLOSE.md`](PHASE4_CLOSE.md). This file remains the Phase 3 evidence.

One Next process: `next-server` pid **48870** on `:3000` (`next dev`). Combined pack: `runs/phase3_isolated_suites_final.txt`. Screenshots: `runs/phase3_screenshots/`. Failed run records kept. Phase 4 not started *(at the time this report was written)*.

## 1. Advocate wording difference (details OFF)

**Cause:** a prior chrome pass hid Heard / Missing / Extra behind Show demo details.

**Fix:** when a required statement is paraphrased, the Now nudge always shows, in plain words: **What was said**, **What’s missing**, **What was added**, next to the exact text. DEMO-* ids stay stripped. Greeting and closing paraphrases use the same word-diff. Screenshot: `03_paraphrase_diff.png` (details unchecked). Full nudge text:

- What was said: These prices might change.
- What’s missing: the exact pricing words
- What was added: these, prices, might

## 2. Now shows only the due required statement

**Cause:** `showNow` parked later *cards*, but `paintFact` / `paintStep` and the answer-loop `nowCard.statements` merge wrote onto the due-now card in place. Quote amounts (`$6` / `$24` / `$15`) leaked that way. F12 still passed because it only called `showNow`.

**Fix (general, every statement / every member):**

- `requiredWordingOnNow` occupies Now for greeting (before identity, when verbatim exists), pricing until exact, and closing while due / paraphrased / unverified.
- `guardNowWording` strips facts, live steps, and statements.
- Answer-loop paints no-op while occupied; finished answers wait on Open needs as **ready**.
- Advocate Now hides quotes, answers, suggestions, enrollment, wrap, and disposition while occupied.

**Proof:** `02_pricing_due.png` — Now is only the exact pricing sentence. No `$6` / `$24` / `$15`. Refill sits in Open needs as Answer ready. Unit: `F12b` in `tests/review_fixes.test.ts`.

## 3. What the wrap / disposition fix did

It did **not** add a code table that picks `COMPLETED_SERVICING` or `TRANSFERRED_COVERAGE_REVIEW`.

**What was wrong:** wrap and disposition ran only after `finalizeCall`. Simple servicing (T02A) and transfer (T01) often never reached that: servicing completion declined, or `recommendDisposition` returned empty because Terra JSON failed the support check / safety gate and there was no retry. The driver then saw `recommended === null`.

**What changed:** `maybeCompleteServicing` actually calls `finalizeCall` when servicing is done; `recommendDisposition` asks Terra for one code from **DEMO-DISPOSITIONS-v1** with cited reasons, up to **3** repair attempts; code only **blocks**:

- any code before an end trigger
- `transferred` without a confirmed connection
- `enrolled` without a confirmed enrollment result

If Terra’s reasons fail the support check, the attempt is rejected and Terra is told why — the gates do not relax, and no fallback picker fills the code. Empty recommendation means three failed model attempts (`disposition_recommendation_failed`), not a missing if-table.

This UI walk (transfer not executed) recommended `UNRESOLVED_FOLLOW_UP` with a pending-case reason — that is the model, not a code rule.

## 4. Model health dots

Presenter demo bar always shows **Luna** and **Terra** dots (green / red / gray), independent of Show demo details. HTTP status and error text only with details on. Never in the advocate Now / Context / Transcript columns. Visible in every screenshot in `runs/phase3_screenshots/` (green after first calls).

## 5. Two recent fixes are general

**T04B — utterance-named pharmacy wins; a denied pharmacy is not re-fetched**

Rule in `lib/utteranceRules.ts` (`resolveQuotePharmacyId`):

1. Parse “not X — Y”, “Y instead of X”, “not X, Y instead”, “instead of X, Y” (any names).
2. Match denied / replacement against **whatever pharmacies the session has** (quotes + refill prefetch), by name or id — not a Lakeview / Oak Street list.
3. Unknown names slugify (`Hilltop Pharmacy` → `hilltop`).
4. Utterance replacement wins. Luna’s id is used only if it is not denied.

Removed: `PHARMACY_LABELS`, `/lakeview|oak street|centerwell/` branches in `pharmacyIdFromUtterance`, Luna `qp` enum `l|o|c`. N6b tests Riverside/Hilltop as well as Lakeview/Oak Street.

**T06A — dates and limitation sentences**

In `lib/supportCheck.ts` only: month names map to ISO; leading “On” is not a person name; “The cause is not confirmed.” is an epistemic limitation, not a fact to cite. Applies to every statement and every member. No member / overlay / amount branch.

## 6a. Combined 3× pack (after these fixes, one `:3000`)

Log: `runs/phase3_isolated_suites_final.txt`. Window 15:55:21Z–16:06:25Z.

| Suite | Pass count | Notes |
|---|---|---|
| T01 | **3/3** | ~68s / 53s / 52s |
| Six replays | **1/3** | Runs 1–2: T06A `waitUntil` 20s for `historical_price.answer` (sessions `6852a5ca-…`, `178647ca-…`). JSONL shows the $8/$27 support check did land. Run 3: T06A **5046 ms**, suite pass. Failed records kept. T02A/T03A/T03B/T04B/T08B passed on every run. |
| Chain | **3/3** of 10/10 | Files `runs/chain_eval_1789920069802.json` (1 over 8s), `…100955.json` (0), `…131042.json` (0) |
| Not-canned | **3/3** | |
| Five-member NBA | **2/3** | Run 3: M005 had no model `none` proposal (`tests/nba_members.test.ts:79`). Record kept. |

**Model errors:** `runs/openai_http.jsonl` in this window: **588 calls, 588 HTTP 200, 0 failures** (230 Luna, 358 Terra). Mean **1709 ms**. No 429 / credit errors.

**Time per chain answer (ms), honest 8s:**

| id | run 1 | run 2 | run 3 |
|---|---:|---:|---:|
| c01 $8/$27 | 2238 | 3665 | 4019 |
| c02 five-step | **9647 over 8s** | 4314 | 4518 |
| c03 preferred | 1941 | 2111 | 1774 |
| c04 mail vs today | 2992 | 3450 | 3084 |
| c05 lisinopril | 1274 | 2060 | 1188 |
| c06 other-plan | 1719 | 2076 | 1863 |
| c07 case chain | 3813 | 3265 | 3800 |
| c08 Ozempic case | 2652 | 2316 | 2357 |
| c09 mail + cases | 3253 | 2932 | 2916 |
| c10 quotes after consent | 4319 | 4072 | 3740 |

The 8-second target is unchanged. c02 run 1 is a real miss.

## 6b. Advocate-view audit (demo details OFF)

Browser: Cursor tab `http://127.0.0.1:3000/` (view `11d600`). T01 walked with Resume / human clicks to wrap. T02A used for typed question + End call. Other replays: isolated pack, not a full UI walk each.

| Beat | File | Result |
|---|---|---|
| Before verification | `01_before_verification.png` | Caller Not verified. Now = exact greeting only. |
| Pricing statement due | `02_pricing_due.png` | Exact wording only. No quote amounts. Open needs marked ready. |
| Paraphrase difference | `03_paraphrase_diff.png` | What was said / missing / added with details off. |
| $8/$27 + source tags | `04_827_answer.png` | Claims / Plan rules tags. |
| Suggestion card | `05_suggestion_card.png` | Offer / Dismiss on Now (late in T01; also `05_suggestion_offer.png`). |
| Enrollment readback | `06_enrollment_readback.png` | Metformin-only draft, retail stays. |
| Wrap | `07_wrap.png` | Wrap (editable) + disposition recommendation. |
| Typed question | `08_typed_question.png` | T02A presenter-typed refill ask; pickup facts on Now. |
| Wrap after End call | `09_wrap_after_end_call.png` | T02A End call → wrap. Scripted stream had already started; UI Start always plays the scenario stream, so this is not a zero-stream call. |

T01 UI disposition was `UNRESOLVED_FOLLOW_UP` because destination confirm / execute transfer were not completed in the click loop (mint stayed enabled). Automated T01 **3/3** still confirmed `TRANSFERRED_COVERAGE_REVIEW`.

## 6c. `lib/` and `app/` keyed-name search

Hits after this pass:

| Where | What | Keep / remove |
|---|---|---|
| `lib/session.ts` `selectedMemberId ?? "DEMO-M001"`, `scenarioId ?? "t01_m2a"` | Session start defaults | Keep: presenter/test default, not a routing table. |
| `lib/session.ts` / `nowOccupancy.ts` `DEMO-GREETING-v1`; copilot `DEMO-PRICING-v1`, `DEMO-CLOSING-v2` | Registry ids | Keep: fixture requirement lookup, verbatim from registry. |
| `lib/interpret.ts` `electionMetforminOnly` | Luna bit `el` = split election | Keep as leftover **name**; logic uses `electedMedications`, not the string metformin. |
| `lib/interpret.ts` few-shots | invented layout (`paid-last-April-at-other-counter`, …) | Keep: no member, amount, or pharmacy. |
| `lib/nba.ts` `warm_transfer` | playbook `Advocate control` | Keep: control type from playbook text, not a suggestion-id table. |
| `lib/utteranceRules.ts` `last month\|yesterday\|paid` | historical vs prospective cue | Keep: general English, not Harry amounts. |
| `app/page.tsx` scenario/member selects, `SCENARIO_OVERLAY` | presenter chrome | Keep: overlays only on Start. |
| `app/api/simulated/**` `T04B`+`lakeview`, `T06A`, memberId filters, `centerwell_pharmacy_service` | simulated REST | Keep: PLAN — fixtures live only in `/api/simulated/*`. |
| `app/api/session/start` default member/scenario | same as session defaults | Keep. |

**Removed this pass:** hardcoded Lakeview/Oak Street/CenterWell pharmacy labels; Luna `qp` `l\|o\|c`; `thinSnapshot` metformin/atorvastatin lines; `questionCouldChange` drug-name list; “Add atorvastatin to draft” fallback.

## Prior packs (kept)

- `runs/phase3_isolated_suites.txt` (pack 1)
- `runs/phase3_isolated_suites_after_fixes.txt` (pack 2)
- `runs/phase3_replays_after_quote_fix.txt`
- Failed T06A / NBA JSONL from today’s pack

---

## Follow-up (20 Sep 2026, after Phase 3 report accepted)

One Next process: `next-server` pid **48870** on `:3000`. Chain and not-canned were **not** run. App is idle after this write-up.

### 1. Open call

New scenario `open_call`: greeting (exact recorded-line wording) then simulated authorization VALID for the presenter-picked member. No later script. Presenter drives Caller says… / You say… / Try a question / End call.

Scripted scenarios (T01 and the six replays) lock the member picker to **Harry Whitfield** (`DEMO-M001`) and say so on the demo bar. Open call leaves the picker free.

Hand check (`runs/open_call_handcheck.json`): each of five members, typed “Is my current prescription ready to pick up today?”, End call. All five: greeting `exact_timely`, identity VALID on the chosen member, wrap with cited reasons, disposition recommended.

| Member | Answer | Disposition |
|---|---|---|
| Harry | Atorvastatin ready at Lakeview | `COMPLETED_SERVICING` |
| Mina | Lisinopril shipped from CenterWell | `UNRESOLVED_FOLLOW_UP` (shipped ≠ pickup) |
| Owen | No supported pickup record | `UNRESOLVED_FOLLOW_UP` |
| Priya | No supported pickup record | `UNRESOLVED_FOLLOW_UP` |
| Luis | No refill request on file | `UNRESOLVED_FOLLOW_UP` |

This used the same start / ingest / End call APIs as the presenter buttons, not a screenshot walk of the picker.

### 2. T06A flake

**Found:** Luna sometimes did not tag the $8/$27 question as `historical_price`. The loop filed the finished answer on `unrecognized_request` and **parked it off Now** because focus was still `listening`. Support check had already kept the charges. The 20s wait looked only at `historical_price.answer`, so it timed out while the answer sat on another need.

Failed sessions kept: `6852a5ca-…`, `178647ca-…`.

**Fix (general):** if focus is still opening/listening, a finished answer for the current question occupies Now (unless a required statement does). The replay wait and T06A assertions check **charges on screen with source tags and “not confirmed”**, not a need label. No scenario/amount/pharmacy branch.

**This pass:** six replays **once** — **6/6 pass**, T06A **5132 ms**. Log: `runs/phase3_replays_after_open_call.txt`. T06A was not re-run extra times.

### 3. Missing “none” for Luis

**Found:** not silent, not the 8s cap, not an HTTP error. Session `cc4ee95a-…` (pack run 3) **did** log a suggestion: Terra proposed `optional_comparison` instead of `none`. The wait treated any NBA row as done; the assertion wanted `proposal` + `action: none`.

Silent paths that still existed: model-failed answers skipped NBA; stale generation skipped apply; cap_drop could be followed by a second `none` log.

**Fix:** every suggestion attempt logs exactly one of: `proposal` (including `none` with reasons); `hard_stop` (named); `cap_drop`; `failed` (status). Cap drop no longer also writes `none`. Prompt restates: if the none playbook matches confirmed facts, action must be none. No member-id or action-id picker.

**This pass:** five-member suggestion proof **once** — **pass**. Luis: model `none` from `DEMO-PLAYBOOK-NONE-v1`. Log: `runs/phase3_nba_members_after_open_call.txt`.

### Shared-state check

T01 **once** after the above — **pass** (62s). `runs/phase3_t01_after_open_call.txt`.

### Testing rule

Recorded in `AGENTS.md` (wording-only = screen; one-area = that suite once; shared call state = T01 + affected suite; 3× only when asked).

