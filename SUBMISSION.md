# SUBMISSION.md — Humana Use Case 2: Agent Assist for Advocates

**Candidate presentation pack.** Product behavior is defined in `docs/FINAL_PRODUCT_DECISIONS.md`. How to run the app is in `README.md`. This file is the five Humana artifacts plus the reasoning the brief asks us to show.

Synthetic data only. Figures from the Humana brief are assignment context, not independently verified statistics. Nothing here is Legal-approved Humana policy, a measured compliance lift, or a production claim.

---

## 1. Problem Brief

**Who it is for.** A recently ramped but independently operating Member Services / Pharmacy advocate. They can own the call. They have not memorized years of scripts, exceptions, and system paths. Experienced advocates should benefit too; they are not the design test. The test is: does this help them talk to the member, or become another system they have to operate?

**The job on the call.** Five things at once: say required wording exactly, assemble the member’s facts from several systems, follow a changing flow, handle hesitation without pressure, and record what actually happened. Search does not remove unfinished work or a disclosure deadline.

**Current pain (from the brief, labeled as such).** Missed or paraphrased legal wording (a compliance finding). Inconsistent answers. Tab-switching and dead air. Heavy after-call notes. Slow ramp. QA samples a fraction of calls, so some misses appear weeks later. Volume and scrutiny are described as rising while tenure falls. Those are brief-provided conditions, not a baseline we measured.

**Why now.** Conversational models can follow a live call and ground answers in member records. The useful move is support *during* the conversation, not another knowledge chatbot and not “we will catch it in QA.”

**The opportunity we claim — and do not claim.** Lead outcome is **catch-and-correct**: put exact wording on screen before its deadline; detect a miss or paraphrase within seconds; support an exact reading on the same call; keep the finding honest if it was late. The product cannot stop an advocate from speaking, so we do not claim **prevention**. Service quality matters (right facts, preserved choice, truthful handoff). Capacity from less searching and reconstruction is a follow-on benefit, not a license for a shorter call with more disclosure failures. Enrollment conversion is not the goal; an informed decline is a valid outcome.

**Member.** Harry should get relevant help without pressure or unauthorized action. Retail preference and metformin-only selection must survive comparison, confirmation, write, and wrap.

---

## 2. Service Design

Illustrative reconstruction of the brief’s search / memory / documentation problem — not a verified Humana SOP.

### Today

| Stage | Work | Pain |
|---|---|---|
| Before / open | Routing hint, scripts, identity | Opening wording competes with listening |
| Understand / respond | Join records to policy; find the next line | Missed wording, inconsistent answers, tab switching |
| Adapt | New question, hesitation, changed choice | New obligations; forgotten needs; stale guidance |
| Outcome / handoff | What was authorized vs what another role must do | Wrong-scope action; “resolved” when it is not |
| After | Notes, disposition, sampled QA | Reconstruction from memory; late findings |

### With the copilot

The workspace is the **primary call view** (standalone page in this prototype; intended as embedded in the advocate desktop). One **Now** card. Open needs stay visible. Obligations live on a rail. Member fields appear only after simulated authorization.

| Stage | Future | Human still does |
|---|---|---|
| Open | Exact greeting from the registry; IVR is provisional | Speaks the greeting; Resume is not identity |
| Respond | Call type and current step from evidence; sourced answer or due-now wording on Now | Speaks; inspects sources |
| Adapt | Needs persist across focus changes; obligations from conversation, not an Offer click; stale quotes invalidate | Chooses focus; does not rubber-stamp every update |
| Recover | Uncertainty stays uncertainty; exact reread; no consent attestation in this take-home | Rereads; does not attest a miss away |
| Handoff | Drafted packet; human confirms destination; connection result observed | Confirms transfer; does not treat connection as coverage |
| After | Editable wrap from evidence; recommended disposition | Confirms the code; may edit the wrap |

A ready answer is not a resolved need. A declined optional offer is success. Changing topic does not cancel a due disclosure.

**Demo contrast (said once, fictional call, not a Humana baseline).** Without the copilot, the pricing statement is never read and is found later only if sampled; metformin is a hunt across records; the wrap is reconstructed. With it, exact wording is on screen before the estimate, a miss is caught in seconds (1s design target, measured honestly), the exact statement is read before Harry chooses, the record is *delivered correctly, but late*, and wrap/handoff are drafted from evidence.

---

## 3. Working Prototype

**Run:** `npm install && npm run dev` → http://localhost:3000. `OPENAI_API_KEY` in `.env` (not committed). **Start main call** for Harry. **Replay T02A–T08B** for contrasts. `npm test` for C-checks and live replays; `RUN_T01=1 npm run test:t01` for an automated main.

The page stands in for an **embedded** desktop. It is not a typed-question chatbot.

### What the main call shows (brief “must show”)

| Brief requirement | Where it is |
|---|---|
| Live call context | Timed stream (partial / final / corrected / uncertain). Strip: identity, call type, need/step. Compact transcript. |
| Correct verbatim in-flow | Greeting, pricing, and closing text from `GET /api/simulated/scripting/disclosures`, byte-for-byte. Quiet greeting. Pricing due-now takes the Now card. |
| Real-time nudge on a miss | Two-stage trigger (registry patterns, then luna). Paraphrase diff. Late exact kept as a finding. |
| Auto wrap / handoff | Terra drafts from evidence. Human confirms transfer and disposition. Connection ≠ coverage resolution. |

Also: call-type change from evidence (Refill → Education / enrollment); grounded `$8` / `$27` historical; FAST90 lineage; optional Offer; governed hesitation; hedge ≠ yes; metformin-only human enroll; pending Jardiance read-only.

### Real vs simulated

| Real (input-dependent) | Simulated and labeled |
|---|---|
| Interpretation, trigger classification, composed retrieval, ranked SEARCH, answer/wrap/handoff drafting | Telephony/ASR/IVR, identity, benefits, claims, pharmacy, provider, scripting store, coverage-review read, transfer result |

Models: fast `gpt-5.6-luna` (`reasoning.effort: none`); mid `gpt-5.6-terra`; embeddings `text-embedding-3-small` (documents once at startup; query only per SEARCH).

**Retrieval boundary (recorded override):** app/lib do not import fixtures. §15 data is loaded only inside `/api/simulated/{benefits\|eligibility\|claims\|pharmacy\|provider\|scripting}` plus telephony and coverage-review beside the six. Enrollment `POST` is **403** without a one-time human-minted token. AI tools cannot mint or submit.

**Authority.** AI may surface the next step, detect wording, and draft. AI recommends Offer, objection copy, transfer destination, and disposition. Human only: enrollment write, coverage determination, payment, clinical advice. Hiding a button is not the boundary; the pharmacy write requires the token.

### How we proved it (Tier 2)

Driver injects transcript, system events, and human clicks. It **never** injects AI classifications, answers, or badges. Goldens live under `tests/` (ESLint blocks `app/`/`lib/` from importing them).

| Evidence | Result (18 Sep 2026) |
|---|---|
| C01 exactness, speaker, stitch, stage-1 estimate, generic “prices vary,” no attestation tool | Pass |
| C02 token/scope, pending transfer ≠ connection, HTTP enroll 403 | Pass |
| C03 no member before auth; retrieved instructions cannot mint/submit | Pass |
| C05 amount/entity samples (false plan-change, false approval, coercive enroll rejected) | Pass |
| C06 UI (Resume/auth, due-now title, human Confirm disposition) | Walked on T02A and T04B |
| Replays T02A, T03A, T03B, T06A, T08B | Pass |
| T04B Lakeview `$60` not relabeled as Oak Street | Failed once; pass after invalidation fix |
| Automated T01 | Pass ~90s |

JSONL run logs are under `runs/`. Failures are kept. Stretch QA view and Tier 3 (attestation, retry, unknown write, outage) are **not built**; those conditions show an honest limitation.

---

## 4. Product Roadmap

**Order:** prove a bounded compliance-and-service experience → pilot where prospective estimates and optional-service discussion actually occur → deepen the same operation → reuse patterns across families and channels. Launch starts a learning loop; it does not prove value.

**Principle (same as the key tradeoff):** put in front of advocates first what is bound to exact text and records. Hold judgment-heavy suggestions in **shadow** until relevance and approved content exist.

| Phase | What and why | Gate |
|---|---|---|
| **0 — This prototype** | One Harry call, six contrasts, C-checks. No member risk. | Observed runs, changed-input behavior, known limits. Not business impact. |
| **1 — Bounded pilot** | Live wording verification, sourced answers, wrap/handoff, human-only writes in the existing human process. **NBA/rebuttals default to shadow.** A status-only pilot would barely exercise pricing/closing under these rules, so the candidate family is pharmacy cost / 90-day service with real estimates and service talk. | Independent review of unrecovered vs recovered-late failures; false alerts; latency; net support work. Revise the family if it cannot exercise the benefit. |
| **2 — Deeper same shop** | Visible approved NBA/rebuttals, matched comparisons, scoped action prep, optional evidence-based QA — only with Phase 1 shadow evidence and approved content. | Incremental compliance/service vs workload. Do not promote authority by UI convenience. |
| **3 — More families and channels** | Reuse governed knowledge and instrumentation. Each family/channel needs its own content, permissions, and review. Do-not-call is unsupported here until it has its own process. | Local quality and maintenance cost. Copying the UI is not a channel launch. |

**Learn after launch:** observe → diagnose the right layer (source, retrieval, generation, state, permissions, UI) → change → replay tests → limited release → compare → retain or roll back. Review clean work as well as flagged work. Clicks are not gold labels and not permission to publish legal text.

Exact wording, scope, identity, and human-only actions **cannot** be weakened to improve a dashboard. Suggestion timing and nuisance-alert thresholds can, if missed true obligations are still measured.

**Pilot dependencies (not invented here):** desktop platform and whether five regions fit vs a compact dock; approved registry and how Legal/QA treats a late exact reading vs none; real sources and permissions; representative advocates; speech vs transcript; comparison population and rollback.

---

## 5. Key Tradeoff

**Obligations loud, optional help quiet.** Protect attention rather than maximize immediately visible proactive guidance.

It shows up three times:

1. **Screen.** Due-now wording takes Now. A ready historical metformin answer waits as an open need (“Answer ready”) while today’s refill is primary (beats 4–5). That deferred answer is the demo of the tradeoff; we would not cut it.
2. **Call.** Optional comparison waits for a natural point and an Offer click. It may never be offered. Firm refusal stops the optional branch (T03B).
3. **Roadmap.** Wording verification is live in Phase 1; NBA/rebuttals start in shadow.

**Alternative we rejected:** show current work, every ready secondary answer, and every useful recommendation at once, and let the advocate pick. More visibility; more monitoring; more dependence on the product’s focus being right.

**Cost we accept.** Some correct help is delayed or never offered. That is real. The objective is compliant, manageable service — not maximum recommendation volume.

**Not this tradeoff:** safety vs autonomy. Humana’s matrix already reserves enrollment, coverage, payment, and clinical advice. We did not “trade away” those writes; they have no AI path.

Revisit if advocates miss useful information, constantly reopen deferred work, or spend more effort correcting focus than they save. Compare on disclosure outcomes, effort, and member outcomes — not visual preference.

---

## Show your thinking

### Decisions behind the work

- Catch-and-correct, not prevention. Late exact is still a finding, marked recovered.
- Five-region embedded workspace, not a side-panel chatbot (the brief’s “weak” example) and not another tab.
- Obligations from conversation evidence, not from clicking Offer.
- Hedge is not absolute yes; comparison consent is not enrollment.
- Current selected / readback / confirmed / submitted / returned scope must match; human submit with the wrong returned scope is not success.
- Transfer because Coverage Review can advance `DEMO-CVR001`, not because “coverage is human-only so dump it.”
- Simplest stack that still uses real models and HTTP retrieval. No graph, no mining pipeline, no dashboard, no Playwright for C06.
- Simulated REST-only retrieval (Harish override of “one synthetic store”). Fixture JSON is handler-only.

### Deliberately not built

Quick ask, attestation, read retry, unknown-write status check, outage mode, stretch QA, remaining test catalog. If those conditions occur, show a limitation — never a fake success.

Rejected paths we did not sneak back in: conversion-led funnel; beat-keyed answers; cheapest-pharmacy claim that omits a matched retail option; attestation as verified speech; always-on feed; generic retry of legal text.

### Assumptions (four brief categories)

- **Members:** Harry interrupts, prefers retail, chooses metformin only — authored case, not a mix rate. Missing evidence narrows the answer; no clinical fill-in.
- **Advocates:** Early wrong suggestions cost trust faster than later accuracy restores it (hypothesis for shadow-first). Focused screen helps appropriate reliance (hypothesis until users show it).
- **Data / operations:** Desktop can host this view (unverified). Late exact is better than none (Legal/QA decides; if not, lead measure reverts to total failures). Fictional roles/queues.
- **Constraints:** Timed text + simulated systems demonstrate behavior, not production ASR or throughput. 1/2/5/8s are prototype targets; luna warm-path was measured with honest 1s misses on a keep-alive sample (median 899 ms, 4/10 over 1s). No savings percentage is supplied.

### Experience that shaped this

**GoHealth (Medicare agent product).** Newer agents hunted fragmented plan/drug/provider/pharmacy/member sources; experienced agents had internalized a decision process. Disagreements were often missing context or inconsistent data, not a weak model. **Here:** join facts to the current step, keep unfinished needs, match quantity/date/conditions before comparing amounts. Do not ship a knowledge chatbot and leave coordination to the advocate.

Historical GoHealth figures (~1,500+ calls/day; ~30% lower overall call time and ~50% lower plan-selection time for newer agents) are **that product’s reported outcomes**, not a Humana forecast, and not claimed as a randomized study.

**interface.ai.** Retrieval can cite a conflicting public page next to internal policy. Governance has to separate candidates from approved institution knowledge. A citation is not applicability and not proof an action occurred. **Here:** registry text vs member records vs derived FAST90 lineage; reject `DEMO-POLICY-OTHER-v1`; abstain on historical cause when `DEMO-NET0818` is removed (T06A); separate exact checks (C01–C03) from semantic claim review (C05).

Do not read this prototype as mature production trust or live financial-write coverage from that work.

### What we would validate next / do differently

Observe real advocate desktops and a real call family before defending Harry as the mix. Confirm Legal/QA treatment of late exact readings. Test speech vs our timed text. Run recently ramped and experienced advocates on assisted vs manual tasks, including refusals.

With more take-home time: usability on the core, highest-risk deferred cases (unknown write, attestation policy), then optional evidence-based QA. Not a large corpus or a dashboard first.

**Concurrency.** Model calls are fire-and-forget and parallel (interpret, a hedged priority trigger call, terra). Look for races — results applied out of order, a disclosure trigger or member need dropped as stale, double-apply from the two hedge legs, and any state written from a late async result after a human action changed scope or consent.

On another attempt: lock the business outcome and first call family before expanding the contract; build the slice early enough to hit timing/interaction problems; grow tests from actual failures rather than making the whole catalog mandatory up front.
