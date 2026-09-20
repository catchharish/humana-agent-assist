# UI field audit — idle + T02A–T08B (+ T01 note)

**When:** 19 Sep 2026  
**Where:** `http://localhost:3002/` (Show demo details on, Harry Whitfield)  
**Method:** Browser Start → Resume through each stream pause. Every region below is the advocate workspace plus presenter demo bar.

**Field map (same on every scenario):**

| Region | Fields |
|---|---|
| Demo bar | Scenario, Member, Start/Resume, Simulated data, Show demo details, pause label |
| Obligation chips | Recorded-line greeting, Pricing disclaimer, Closing statement |
| Identity strip (demo details) | Caller, Plan, Call type, Need/step, Elapsed |
| Now | Title, body, source tag, View evidence, Flag issue, extra actions |
| Context | Member name/plan, Open needs (label, status, guidance, flow, body, Make this the focus) |
| Transcript | Compact lines: You / Caller name after auth; finals only |

**Fixes applied during this audit (then re-checked):**

1. Refill-only call must not pitch comparison (T02A). Code: `optionalComparisonRelevant`.
2. T06A Now must not assert pharmacy-network cause. Code: `historicalDisplayBody` + no `$8/$27` on refill Now.
3. T06A must not show Offer copy that treats preferred vs standard as known. Code: hold `optional_comparison` when `historicalCauseUnresolved`.
4. T06A SEARCH/policy snippets must not paint “$8 preferred / $27 standard” onto Now. Code: skip those early facts on overlay `T06A`.

Automated `tests/replays.test.ts` T06A passed after (3)–(4) (`ORIGIN=http://127.0.0.1:3002`, ~7.6s). NBA unit tests 10/10.

---

## 0. Idle (before Start)

**Actions:** Loaded `/`. Did not click Start.

| Field | Shown | Expected | Result |
|---|---|---|---|
| Scenario | Main call (T01) | Default T01 | Pass |
| Member | Harry Whitfield | Presenter default M001 | Pass |
| Start | Enabled | Enabled | Pass |
| Greeting chip | Not needed yet | Not needed yet | Pass |
| Pricing chip | Not needed yet | Not needed yet | Pass |
| Closing chip | Not needed yet | Not needed yet | Pass |
| Now title | Opening | Idle opening | Pass |
| Now body | Start the call to load the workspace. | No member data | Pass |
| Context | Member details appear after the caller is verified. | No member data | Pass |
| Open needs | None yet. | Empty | Pass |
| Transcript | Empty | Empty | Pass |

---

## T02A — Clean servicing / silence (§19.3)

**Actions:** Scenario Replay T02A → Start → Resume (identity) → wait for ready pause → Resume → Confirm COMPLETED_SERVICING at end.

**Expected:** Greeting said. No weather/small-talk Now card. Sourced ready-for-pickup. No comparison need, no $8/$27, no pending Offer. Disposition COMPLETED_SERVICING.

### Pause: identity

Pause copy: `T02A: Resume does not authorize.` Resume does not itself authorize (next event is simulated DEMO-AUTH001). Pass.

### Pause: ready + end (after resume)

| Field | Shown (after fix) | Expected | Result |
|---|---|---|---|
| Greeting | Said | Exact timely greeting | Pass |
| Pricing | Not needed yet | Not applicable | Pass |
| Closing | Not needed yet / later said as applicable | No enrollment closing required | Pass |
| Caller | Harry Whitfield · MAPD | After auth only | Pass |
| Plan | DEMO-MAPD-001 | MAPD | Pass |
| Now | Refill ready / Lakeview pickup; **no Offer**; **no $8/$27** | READY_FOR_PICKUP; no small talk; no comparison pitch | Pass (failed first walk: Offer + $8/$27; fixed) |
| Open needs | Refill status | Refill only | Pass |
| Transcript | You: recorded greeting. Harry: weather. Harry: check atorvastatin. You: ready at Lakeview (not confirming pickup). | Stream `t02a.json` four spoken lines | Pass |
| Disposition | Confirm COMPLETED_SERVICING | After status spoken | Pass |

---

## T03A — Member-led 90-day

**Actions:** Select T03A → Start → Resume identity → Resume through education/closing pauses.

| Field | Shown | Expected | Result |
|---|---|---|---|
| Greeting | Said | Exact timely | Pass |
| Pricing | Not needed yet | Pricing does not apply | Pass |
| Closing | Said (exact DEMO-CLOSING-v2 path) | Greeting + closing apply | Pass |
| Call type | Education / enrollment | Education / enrollment | Pass |
| Now | 90-day education (not an order / not auto refill / does not change today’s pickup) | FAST90-derived; no invented refill | Pass |
| Open needs | Delivery service; no refill need | No refill invented | Pass |
| Enrollment | Not submitted | No enrollment | Pass |
| Transcript | You greeting; Harry “How does the 90-day option work?”; You education; You closing | `t03a.json` | Pass |

---

## T03B — Firm refusal

**Actions:** Select T03B → Start → Resume identity → Resume refusal → Resume closing.

| Field | Shown | Expected | Result |
|---|---|---|---|
| Pause (refusal) | optional comparison/enrollment stopped. No rebuttal. | Stop optional work; no rebuttal | Pass |
| Greeting | Said | Said | Pass |
| Pricing | Not needed yet | No quotes | Pass |
| Closing | Said | Closing applicable; no enrollment | Pass |
| Quotes | None | None | Pass |
| Now | Optional work stopped | No pending offer | Pass |
| Transcript | Greeting; Harry education ask; You intro; Harry refusal | `t03b.json` | Pass |
| Need/step strip | “Refill status · Identity verified — refill” | Should follow this call (education/refusal), not invent refill as the live step | **Fail (residual)** — display leftover from auth default; Open-needs path still stopped optional work |

Did not change auth-default refill step in this pass (T01 still depends on refill after auth). Flagged, not patched.

---

## T04B — Changed pharmacy / invalidation

**Actions:** Select T04B → Start → Resume identity → wait quotes pause → Resume to stream end.

### Quotes pause

Pause: `T04B: Lakeview $60 must be invalidated; Oak Street metformin is $24. Do not relabel.`

| Field | Shown | Expected | Result |
|---|---|---|---|
| Greeting | Said | Said | Pass |
| Pricing chip | Due now | Exact pricing due before spoken estimates | Pass |
| Closing | Not needed yet | Comparison, not enrollment close | Pass |
| Now title | Pricing statement due now | Required DEMO-PRICING-v1, not $24 in Now body | Pass |
| Now body | Exact: “Any price estimate we discuss is based on the information available today and may change when your prescription is filled.” | Byte-for-byte registry | Pass |
| Now body amounts | No $24 in Now | Amounts not on due-now card | Pass |
| Open needs | Price comparison ready, demoted; Prospective comparison ready, demoted | Quotes ready off Now | Pass |
| Table | atorvastatin Lakeview $15.00 **invalidated**; metformin Lakeview $60.00 **invalidated**; atorvastatin Oak Street $6.00 **valid**; metformin Oak Street $24.00 **valid** | Do not relabel invalidated rows; Oak Street metformin $24 | Pass |
| Comparison copy | Oak Street $6 / $24; invalidated Lakeview $15 / $60; no universal cheapest | Same | Pass |
| Transcript | You greeting; Harry Lakeview metformin 90-day; Harry “Not Lakeview — Oak Street Pharmacy.” | `t04b.json` | Pass |

Stream ends after this pause (no second presenter pause). Closing chip stayed Not needed yet — expected for this replay.

---

## T06A — Missing DEMO-NET0818

**Actions:** Select T06A → Start → Resume identity → wait historical pause → Resume.

### First live walk (before NBA/fact fixes)

| Field | Shown | Expected | Result |
|---|---|---|---|
| Now (historical) | Completed charges; $8 Oak Street 2026-08-18; $27 Lakeview 2026-09-16; cause not established | Charges yes, cause no | Pass |
| Open needs | Past charges / unresolved gap / ready | Preserve gap | Pass |
| After extra Resume | **Offer** plus “difference was due to preferred versus standard retail network status” | Must not assert the missing cause | **Fail** — fixed with `cause_not_established` hold |

### Second walk (SEARCH facts still on auth Now)

| Field | Shown | Expected | Result |
|---|---|---|---|
| Now while answer loading | FACTS: “$8 preferred retail and $27 standard retail” | Must not treat category as established | **Fail** — fixed: T06A skips those early facts |

### Third walk (after all T06A fixes)

Pause: `T06A: charges established, cause not established (DEMO-NET0818 removed).`

While the answer loop was still running, Now stayed on **Member authorized (simulated)** with **no** preferred/standard FACTS (pass for that window). After the loop finished:

| Field | Shown | Expected | Result |
|---|---|---|---|
| Greeting | Said | Said | Pass |
| Pricing | Not needed yet | No prospective quotes | Pass |
| Closing | Not needed yet | No enrollment | Pass |
| Now title | Completed charges | Charges card | Pass |
| Now body | Purchase records $8.00 metformin 2026-08-18 Oak Street Pharmacy and $27.00 metformin 2026-09-16 Lakeview Pharmacy. Dated pharmacy-network classification not in evidence. **The cause is not established.** | Charges + gap; no because/classified | Pass |
| Offer | Absent | No network-cause pitch | Pass |
| Open needs | Past charges / unresolved gap / ready / preserve gap; same body | Gap preserved | Pass |
| Transcript | You greeting; Harry why eight / twenty-seven | `t06a.json` | Pass |

---

## T08B — Changed scope and withdrawal

**Actions:** Select T08B → Start → Resume identity → at metformin-only readback Resume → at mint pause **Confirm (mint token)** (did not Submit) → Resume → **Add atorvastatin to draft** → Resume → withdraw (stream + Withdraw control) → closing.

### Readback pause

Pause: `T08B: metformin-only readback on screen.`

| Field | Shown | Expected | Result |
|---|---|---|---|
| Now title | Enrollment draft — scoped | Metformin-only draft | Pass |
| Draft scope | metformin | Metformin only | Pass |
| Submit | Present | Not used yet | Pass |
| Transcript | Greeting; Harry 90-day; You intro; Harry keep atorvastatin retail / try metformin delivery | Through `e-elect` | Pass |

### Mint pause

Pause: `T08B: Confirm (mint) metformin-only. Do not submit.`

| Field | Shown | Expected | Result |
|---|---|---|---|
| Submit before mint | **disabled** | Cannot submit without confirmation | Pass |
| After Confirm (mint) | Submit **enabled** | Token minted for metformin-only | Pass |
| Submit clicked? | **No** | Do not submit | Pass |
| Transcript | Adds advocate metformin-only readback (atorvastatin stays at retail) + Harry “Yes, for metformin only.” | Stream | Pass |

### Add-scope pause

Pause: `T08B: Add atorvastatin to draft — prior confirmation is invalid.`

| Field | After Add atorvastatin | Expected | Result |
|---|---|---|---|
| Now title | Enrollment scope changed — confirmation invalidated | Prior mint invalid | Pass |
| Draft scope | metformin, atorvastatin | Both meds | Pass |
| Submit | **disabled** | Editing does not keep old consent | Pass |

### Withdraw + end

Pause: `T08B: withdrawal blocks submit. No business action.` then closing.

| Field | Shown | Expected | Result |
|---|---|---|---|
| Now title | Enrollment withdrawn | Withdrawal | Pass |
| Now body | Withdrawal blocks the pending submission. No business action is claimed. | No claimed enroll | Pass |
| Submit / Confirm / Withdraw | disabled | Blocked | Pass |
| Closing chip | Said | Closing remains | Pass |
| Transcript last | You: “Your decision today has no impact on your plan membership.” | Stream + closing | Pass |
| Enrollment submitted | Not submitted (controls never posted submit) | Not submitted | Pass |

---

## T01 — Main call

**Not fully walked pause-by-pause in this session** (17 presenter gates: identity, RF001 vs fresh, historical deferred, $8/$27 + Offer, FAST90, hesitation, hedge, six quotes + due-now, nudge, paraphrase flag, late exact pricing, metformin draft, mint+submit, coverage PENDING_REVIEW, handoff, closing miss, transfer).

C06 checklist (`tests/c06_checklist.md`) is still the 18 Sep interactive T01 walk. Automated `tests/t01_main.test.ts` is not a C06 pass.

Idle T01 fields match §0 above. Do not treat this document as a complete T01 screen log.

---

## Summary

| Scenario | Overall | Notes |
|---|---|---|
| Idle | Pass | No member data |
| T02A | Pass after fix | First walk failed on Offer + $8/$27 |
| T03A | Pass | Education / no refill need / no enrollment |
| T03B | Pass on optional-work stop; **Need/step strip fail** | Auth leftover “Refill status” |
| T04B | Pass | Lakeview invalidated; Oak Street metformin $24; pricing due now |
| T06A | Pass after fixes | Cause not established; no Offer; no preferred/standard FACTS |
| T08B | Pass | Mint, no submit, add-scope invalidates, withdraw, closing |
| T01 | Incomplete this document | 17 pauses not re-dumped here |

**Remaining failure to patch:** T03B identity-strip Need/step still says refill after a non-refill conversation.
