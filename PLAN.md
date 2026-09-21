# PLAN.md — Humana Agent Assist (approved 17 Sep 2026)

**This is the only plan we implement.** Cursor’s `.cursor/plans/step_0_prototype_plan_*.plan.md` is a leftover UI draft from Step 0 and is not a source of truth. If the two ever disagree, this file wins.

Approved Step 0 plan with Harish’s nine changes, plus the **18 Sep 2026 reasoning-loop override** below. Product behavior remains [`docs/FINAL_PRODUCT_DECISIONS.md`](docs/FINAL_PRODUCT_DECISIONS.md) §§10–22 / §15 except where this file records an override. Do not reopen the contract. Do not undo the REST override or the reasoning-loop override without asking Harish.

## Recorded override (item 1)

**Contract line overridden (Harish direction):** header *“Source labels do not require six integrations”* and §15 *“Use one synthetic store if convenient.”*

**Replacement:** Per-system **simulated REST is the only retrieval boundary**. App/BFF code must not import fixture JSON for answers. Fixture files load **only** inside `/api/simulated/*` route handlers. Enrollment `POST` returns **403** without a human actor. Replays may inject delay / 404 / overlay via handler headers or overlay files. Later sessions must not collapse this back to in-process fixture reads. Also recorded in [`DECISIONS_LOG.md`](DECISIONS_LOG.md).

These are not real Humana hosts. Paths are `/api/simulated/{benefits|eligibility|claims|pharmacy|provider|scripting}/...` plus **telephony** and **coverage-review beside** the six. Every response: `{ "simulated": true, "sourceSystem": "<one of six | telephony | coverage-review>", "asOf": "<ISO-8601>", "data": { } }`. Payloads are **illustrative shapes — real integration maps to Humana's APIs.** Do not describe them as NCPDP-, CMS-, or FHIR-compliant.

## Recorded override (18 Sep 2026 — reasoning loop)

**Contract / prior PLAN lines overridden (Harish):** header and §16 “do not inflate the corpus”; §16 “one governed derived answer”; PLAN item 6 five-need `routeQuery` and “governed derived FAST90-by-id”; AGENTS “do not add large corpora”; “do not invest first in a graph” as a **deferral with a measured decision point**, not a permanent ban on more documents.

**Replacement — later sessions must not undo:**

- Showing five cases in the demo is fine. Nothing must be canned. The model reasons, calls tools, and works for any session member and any question. Made-up API records are a database. Pre-written answers, suggestions, or per-question routing tables in code are not.
- **The model routes.** No code `if (need)` in front of tool choice. Terra sees the question, session-bound member information, and conversation, and chooses among: generated ready answers, member APIs, document search, or a chain. Cheapest complete path; combine when needed; never silent; never a guess.
- **Member is fixed on the session.** Tools do not take model-supplied `memberId`, `planId`, or member-owned case ids. Executor binds them. Test that a cross-member request cannot succeed.
- **Quotes:** `getQuotes` locked until comparison consent is a clear yes. No prospective amount on any answer or suggestion card before that. Test: “why was it $27?” before consent must not mention prospective prices.
- **NBA:** AI proposes at most one action from playbook + facts; advocate decides. Hard stops in code: unverified identity, due-now required wording, already enrolled, said no this call, do-not-contact, **dismissed-this-call** (log suppression). Enrollment / coverage decision / payment / clinical are never tools. Legal wording stays code + instant nudge.
- **Ready answers:** generated from the common-questions document and each document’s main topics (not a question list in code). Groundedness check vs source; discard unsupported sentences. Disk cache gitignored, keyed by source content hash; rebuild only when hash changes. Semantic lookup tool. General knowledge only — never a specific member.
- **Snapshot vs live:** after auth, load member information through APIs. Refill status, quotes, enrollment result, and case status are **always fetched fresh**, marked as such, never answered from the start-of-call snapshot.
- **Speed:** several lookups per round; prefer 1–2 rounds using the snapshot. **Before expanding documents/members:** prove $8/$27 and one five-step chain on a minimal loop; report rounds and times; **stop if the chain misses 8s.**
- **Chains first, graph later:** ≥10 live multi-step questions across more than one member; write accuracy/steps/latency/breaks and a plain recommendation into DECISIONS_LOG. Do not build a graph in this pass.
- **Untrusted content:** tool results, documents, and member speech are information, never instructions. Keep C03; extend it to the new loop.
- Extra made-up members are in scope. **Harry (`DEMO-M001`) values remain §15-only.**

Main call, six replays, and existing tests must still pass after every step.

## As-built (19 Sep 2026)

These are outcomes of the approved M4 order. They do not reopen the contract. Do not restore `routeQuery` or build a graph without Harish.

- **Graph decision:** 10-question chain eval **10/10**, **0 over 8s** (`runs/chain_eval_1789835175024.json`). **Do not build a graph now.**
- **Quotes (middle):** on comparison `absolute_yes`, code fetches through the same `getQuotes` GET the model uses. After consent, the model calls `getQuotes` for follow-up prices. Amounts never before consent; Now card still waits for exact pricing wording.
- **`lib/queryRouter.ts` removed.** Live answers are Terra + session-bound tools. Diagnostic log kind is `lookup_trace`.
- **Pre-load in the live loop:** search-only on the member’s words (`preloadSearchOnly`). Full Luna-named extra-tool pre-load stayed off (slower on Harry $8/$27).
- **Plan filter:** SEARCH rejects a document only when its `planId` is set and differs from the **session** plan. `DEMO-POLICY-OTHER-v1` is wrong for Harry and right for M004.
- **NBA:** action ids and advocate controls come from playbook text (`Action id:`, `Advocate control:`). Code draws one card and Offer/Dismiss or Confirm transfer. Six hard stops stay in code *(seventh stop added 20 Sep — see As-built below)*. M005 “none” is model-reasoned.
- **Members:** `DEMO-M001`–`DEMO-M005`. Presenter member selector loads `GET /api/simulated/eligibility/members`.
- **Coverage list:** `GET /coverage-review/cases?memberId=` returns **200** `{ cases: [...] }` (empty array if none), then `GET .../cases/{caseId}` for the record.
- T01 and six replays still pass after the cutover.

## As-built (20 Sep 2026 — Phase 4 close)

Packaging and honesty only. Does not reopen the 17–18 Sep overrides. Does not rewrite the 19 Sep graph decision.

- **NBA hard stops in code are seven:** `unverified`, `due_now`, `already_enrolled`, `said_no`, `do_not_contact`, `dismissed_this_call`, `unconfirmed_fact`. Luis / M005 “none” is still model-reasoned from playbook text, not a member-id rule. Every suggestion attempt logs one of `proposal` / `none` / `hard_stop` / `cap_drop` / `failed`.
- **Open call:** presenter scenario `open_call` is greeting + simulated VALID auth for the picked member, then unscripted. T01 and the six replays lock the member picker to Harry (`DEMO-M001`).
- **Now occupancy:** while greeting, pricing, or closing wording is due, Now is that exact registry text only (`requiredWordingOnNow`). Answers wait as Open-needs ready. Paraphrase word-diff is advocate help (visible with demo details off).
- **Disposition:** Terra recommends one code from `DEMO-DISPOSITIONS-v1`. Code only blocks: any code before an end trigger; transferred without confirmed connection; enrolled without confirmed enrollment. No fallback picker.
- **Testing cadence** is in `AGENTS.md` (wording = screen; one-area = that suite once; shared state = T01 + affected suite; 3× only when asked).
- **Proof, kept failures:** Phase 3 combined pack (`runs/PHASE3_REPORT.md`): T01 3/3; replays 1/3 (T06A wait); chain 3/3 with one 8s miss (c02 9647 ms); not-canned 3/3; NBA 2/3. Follow-up after Open call / T06A wait / NBA log: replays 6/6 once, NBA pass once, T01 pass once. Chain and not-canned were not re-run on that follow-up. Phase 4 did not re-run suites.
- **Graph:** still do not build. The 19 Sep chain eval was 10/10 under 8s. The later 8s miss is load, not a missing hop. Do not treat it as a reopen.
- **Wrap-up artifacts:** `README.md`, `SUBMISSION.md`, this addendum, `runs/PHASE4_CLOSE.md` (secrets scan).

## Stack

**Next.js (App Router) + TypeScript + React**, one process. OpenAI via `OPENAI_API_KEY`. In-memory session + JSONL run log. Vitest for disclosure/router unit checks and replay driver later. **No Playwright now** (C06 is a manual UI checklist unless time remains after M3). **No mock REST contract-test suite.**

Standalone page standing in for an embedded call desktop (§14). Say so in README and when presenting.

### Models (re-verified 17 Sep 2026 against [OpenAI Models](https://developers.openai.com/api/docs/models))

Current flagship family on that page is **GPT-5.6** (Luna / Terra / Sol / Astra). Do not use `gpt-4o`, `gpt-4o-mini`, or `gpt-5.4-mini` as the recorded IDs.

| Tier | Model ID | Use |
|---|---|---|
| **Fast** | `gpt-5.6-luna` | Per-utterance interpretation (call type / needs / focus / consent) and disclosure **trigger recognition** on partial transcripts. Catalog: cost-sensitive high-volume; supports `reasoning.effort: none` (required for the 1s path). |
| **Mid** | `gpt-5.6-terra` | Answer tool loop, ready-answer generation, wrap, handoff, NBA draft. `reasoning.effort: none` unless C05 quality fails; do not silently switch IDs. |
| **Embeddings** | `text-embedding-3-small` | Document embeddings computed **once at process startup**. Per request, embed the **query only**. No vector database. |

## Real vs simulated

| Layer | Real | Simulated (labeled) |
|---|---|---|
| Transcript | Consume partial/final/corrected/uncertain | Telephony, ASR, IVR hint |
| Interpretation | Fast-tier model from utterances | — |
| Disclosure exactness/timing/nudge | Plain code + registry text | — |
| Disclosure **triggers** | Two-stage: registry-pattern **code** (instant) then luna on ambiguous partials | — |
| Retrieval | HTTP only; **Terra chooses tools** (no five-need router) | Six simulated REST systems + telephony + coverage-review |
| Answers / wrap / handoff | Mid-tier model from session evidence + tools | Amounts/IDs/status from REST; ready answers generated from docs |
| Enrollment / coverage decision / payment / clinical | **No AI path** | Human `POST` enroll; coverage **read** only |

Test driver may supply transcript, system results, human actions. It may never inject AI classifications, answers, or badges (§19.1).

**Evaluator answers:** live only under `tests/`. Prevention: ESLint `no-restricted-imports` (and TypeScript path) blocking `tests/**` from `app/**` and `src/**` / `lib/**`. CI/lint fails if app code imports golden files. Document this in README.

## Six systems — endpoints in use only

Humana names: **benefits, eligibility, claims, pharmacy, provider, scripting**.

**Coverage case:** not one of Humana’s six tab-hunt systems. Serve **beside** the six, like telephony: `GET /api/simulated/coverage-review/cases/{caseId}`. Label `sourceSystem: "coverage-review"`. Status **read** only; no determination write.

**Telephony:** not a member-data system. Serve **beside** the six: `GET /api/simulated/telephony/ivr/current-hint`, `POST /api/simulated/telephony/transfers`. Label `sourceSystem: "telephony"`. Shown on the architecture diagram.

**Dropped:** practitioner endpoint; extra directory search; payment; coverage determination write; mock contract tests; any endpoint the main call and six replays do not use.

| System | Endpoints (all `/api/simulated/...`) | Why (main + T02A/T03A/T03B/T04B/T06A/T08B) |
|---|---|---|
| eligibility | `POST /eligibility/authorizations`; `GET /eligibility/members`; `GET /eligibility/members/{memberId}`; `GET /eligibility/members/{memberId}/contact-preferences` | List for presenter selector; `DEMO-AUTH001`; member 403 until VALID; NBA prefs |
| benefits | `GET /benefits/plans/{planId}`; `GET /benefits/plans/{planId}/pharmacy-network?asOfDate=`; `GET /benefits/plans/{planId}/cost-share` | Plan; `DEMO-NET0818/0916`; `DEMO-POLICY-COST-v1` / other-plan cost-share; T06A overlay omits NET0818 |
| claims | `GET /claims/pharmacy?memberId=&dateOfServiceFrom=&dateOfServiceTo=` | `DEMO-C0818/C0916` only — no coverage case here |
| pharmacy | `GET /pharmacy/prescriptions?memberId=`; `GET /pharmacy/refill-requests/{id}`; `GET /pharmacy/refill-requests/{id}/status`; `GET /pharmacy/quotes`; `POST /pharmacy/enrollments`; `GET /pharmacy/enrollments/{id}` | Rx, RF001 exist vs fresh ready; six quotes (`validityStatus: "valid"` in the main run); T04B overlay; human enroll `DEMO-ENR001`; T08B no submit |
| provider | `GET /provider/pharmacies/{pharmacyId}` | Lakeview, Oak Street, CenterWell **names/ids from §15 only** — no NPI |
| scripting | `GET /scripting/disclosures`; `GET /scripting/disclosures/{requirementId}`; `GET /scripting/articles/{articleId}`; `POST /scripting/knowledge/search` | Verbatim; `DEMO-SERVICE-v1` / `DEMO-FAST90-v1` / objection; SEARCH returns **raw** candidates including `DEMO-POLICY-OTHER-v1` (copilot filters; mock does not) |
| telephony (beside) | `GET /telephony/ivr/current-hint`; `POST /telephony/transfers` | IVR refill hint; `DEMO-TRANSFER001` |
| coverage-review (beside) | `GET /coverage-review/cases?memberId=`; `GET /coverage-review/cases/{caseId}` | List `{ cases }`; `DEMO-CVR001` pending; not a claims resource |

`POST /pharmacy/enrollments`: one-time **server-minted enrollment token** from presenter Confirm (`POST /api/session/human/mint-enrollment-token`), bound to read-back `medicationScope`. Mock **403** if token missing, already used, or scope differs. **AI tool registry has no mint/read/submit.** Not an `actorType` header.

Delay / 404 / overlay: `X-Demo-Delay-Ms`, `X-Demo-Overlay`, `X-Demo-Force-Status`.

## No facts beyond §15 for Harry (item 3)

**Harry / `DEMO-M001` / main call and named replays:** standard-style **field names** are fine. **Values** only from §15. Do **not** invent or include: ordering clinician, `refillsRemaining`, `rxNumber`, `subscriberId`, `contractId`, NPI, NDC, rxcui, addresses, ANI, or any other non-§15 fact.

**Extra members and extra knowledge (18 Sep 2026 override):** made-up records are allowed if labeled simulated/made-up and they **do not contradict §15 on Harry’s call**. Same field vocabulary; no real people.

Illustrative names we **may** use when the value is in §15 (Harry) or in the extra-member fixtures: `memberId`, `planId`, `lineOfBusiness`, `authorizationId`, `decision`, `role`, `claimId`, `adjudicationStatus`, `dateOfService`, `drugName`, `strength`, `dosageForm`, `quantity`, `daysSupply`, `pharmacy.name` / `pharmacyId`, `memberPaidAmount` `{ value, currency }`, `appliedCostShareCategory`, `fillStatus`, `quoteId`, `estimatedMemberCost`, `asOf`, `validityStatus` (`valid` in the main run — §15 validity status, **not** an invented `validUntil` timestamp), `enrollmentId`, `medicationScope`, `verbatimText`, `requirementId`, `version`, `caseId`, `status`, `requestedMedication`, `determination` (null while pending), `ivrReason`, `connectionStatus`.

Money ISO 4217; dates ISO-8601; DEMO-* IDs unchanged.

## Visible architecture (item 4)

Every evidence label in the UI: **`System record · {system} · simulated`** or **`Governed guidance · scripting · simulated`** or **`Derived from source/version · scripting · simulated`**.

README contains the system diagram (same as below).

```mermaid
flowchart LR
  ui[AdvocateUI]
  bff[CopilotBFF]
  router[toolLoopTerra]
  fast[gpt-5.6-luna]
  mid[gpt-5.6-terra]
  elig[eligibility]
  ben[benefits]
  clm[claims]
  rx[pharmacy]
  prov[provider]
  scr[scripting]
  tel[telephony]
  cvr[coverageReview]
  ui --> bff
  bff --> fast
  bff --> mid
  bff --> router
  router --> elig
  router --> ben
  router --> clm
  router --> rx
  router --> prov
  router --> scr
  bff --> tel
  bff --> cvr
```

## Query router (item 6) — OVERRIDDEN 18 Sep 2026

Do **not** implement the five-need `routeQuery` compose order below as the live answer path. Historical $8/$27 must still use purchases + dated classifications + SEARCH, still reject a **wrong-plan** policy (for Harry that is `DEMO-POLICY-OTHER-v1`) with a logged reason, and must not be fetch-by-ID. The **model** chooses those tools; copilot code does not switch on need kind. Filter is session `planId`, not “OTHER is always wrong.”

Speed: parallel tools in one round; session snapshot for stable facts; live GET for refill status, quotes, enrollment, case status.

**Pre-load (Harish, 18 Sep 2026):** For every member question, in parallel: (a) document search on the member’s own words (top few chunks labelled pre-loaded); (b) Luna names expected **tool names** from the allowed list (not a code intent→lookup table). Code runs those session-bound tools immediately and hands results to Terra’s first round. Terra may still call any tool. Never pre-load quotes before comparison `absolute_yes`. Never another member. Keep the bundle small. Log pre-loaded vs used vs fetched anyway. **Learning pre-load from past run logs is the next step, not built now.**

**Former order (do not restore as a routing table):** disclosure registry (still code, not an answer tool) → structured lookup → governed derived FAST90-by-id (**removed**) → ranked SEARCH → partial/withhold.

Log every tool used, per-tool and per-round latency, retrieved IDs, rejected IDs + reason, ready-answer lineage if any.

## Disclosure (item 7)

| Concern | Implementation |
|---|---|
| Exactness, stitching rules, timing vs delivery, obligation state, **fixed nudge templates** | Plain code + registry `verbatimText` (byte-for-byte) |
| Trigger recognition | **Two-stage** (pricing and “service choice actually discussed”). Keep `gpt-5.6-luna`. **Do not relax the 1s target.** |

**Stage 1 (code, instant — no model).** Fire the pricing trigger only when **all** hold:

1. Advocate utterance contains an amount (digits or spelled-out).
2. It contains a future-estimate cue from the **registry** trigger patterns (not code constants).
3. Current need is prospective comparison.

Stage 1 **must never** fire on historical-charge speech. A fired compliance nudge **must never need retracting**.

Same two-stage idea for closing/service-choice: stage 1 only when registry cues plus actual discussion evidence are complete; otherwise stage 2.

**Stage 2 (`gpt-5.6-luna`, `reasoning.effort: none`).** Anything ambiguous — amount without a cue, amount during the historical-price need, comparative language without a figure, incomplete service-choice discussion. Run on **partials**. Log classification and measured latency. Record 1s **misses honestly**.

**Clock (§22.1):** starts at the first transcript event containing a **complete amount plus estimate context**. Classification may start earlier on partials; the clock definition does not move.

**Warm-up:** keep-alive HTTP client. Luna warm-up at **call connect**. Terra warm-up at connect for the answer loop. Document embeddings: once at startup (and when source hashes change); query embedding per SEARCH / ready-answer lookup.

**C01 (M3, not M1):**

- Stage-1 hit: “Lakeview estimate is fifteen dollars” during prospective comparison — fires **without** a model call.
- Stage-2 case: estimate language spoken during the **historical** discussion — luna; must not produce a retractable pricing nudge.
- Historical “$8 / $27” speech **must not** trigger pricing (stage 1 silent; stage 2 if invoked must classify historical / none).

Quiet greeting: code exactness on adequate advocate transcript vs `DEMO-GREETING-v1`. No acknowledgement click.

## Demo mechanics (item 9)

- Advocate lines stay in the **timed stream**. Presenter-gated **pauses** at advocate reaction points. Mark pause intervals; **never** count them as machine response time.
- Stretch / QA view **off**.
- `SUBMISSION.md` **deferred until after M3**. Ambiguity 9 stands until then. **As-built 20 Sep:** file exists after M3 and was aligned at Phase 4 close. Presenter **Open call** is greeting + auth, then unscripted; scripted T01/replays lock to Harry.
- C06: **manual UI checklist**; no Playwright setup now.

## Fixtures (handler-only)

Built from §15: disclosures, member, auth, prescriptions, refill, purchases, classifications, policies (incl. OTHER), quotes, service/FAST90/objection, roles, coverage, actions, `streams/t01_main.json` (M1 subset first). Replay streams in M3. Evaluator conclusions **not** in fixtures.

## Stream, state, log

Timed player: partial/final/corrected/uncertain. Pause/resume marked.

State §13: call type, needs, focus, guidance validity, obligations, action pipeline — from evidence, **never beat numbers**. T06A remains the changed-input proof.

Log §22.3 JSONL + diagnostics: events, identity, source/rule versions, selected/rejected evidence, route, trigger classifications, human actions, timing (event-to-useful-display), usage, injected faults. No chain-of-thought or secrets.

## UI

Five regions §14: call strip (no member fields before `DEMO-AUTH001`), obligation rail, Now card, context drawer, compact transcript (partial/final/corrected/uncertain not by color alone). Evidence labels include source system (item 4).

## Build order

- **M1** — Walking skeleton: timed stream (partial/final/corrected), five-region screen, quiet greeting verify, no member data before simulated auth (`POST` eligibility). Live REST: eligibility, telephony IVR **and** `GET /scripting/disclosures`. Luna keep-alive **warm-up at call connect**. Pause gates. Show the app.
- **Then** remaining simulated REST, router, SEARCH, trigger classifier — needed before/during M2, not a separate product.
- **M2** — Full §10/§20 main call with Harish as advocate. **No M3 until M2 runs end to end.**
- **M3** — Two fresh mains, six replays, C01–C03 and C05–C06 (C06 manual). Keep every run record.
- **M4** — Reasoning loop. Order: standing files → **speed gate on current fixtures** (stop if five-step chain > 8s) → extra members/docs → Terra tool loop cutover → NBA hard stops → ≥10 chain eval → DECISIONS_LOG graph recommendation (no graph built). T01 and six replays must pass after every step. **Done 19 Sep 2026** (see As-built 19 Sep). **Phase 4 wrap 20 Sep 2026** (see As-built 20 Sep) — packaging/honesty only, no new product.

Time-cap cut order §10. Never cut beats 4–5, 9, 10, 12, 13–15.

## Deliverables

Running app; `/fixtures`; tests for M3; `runs/`; `DECISIONS_LOG.md`; README (real vs simulated, how to run, limitations, architecture diagram, import exclusion). `SUBMISSION.md` after M3; aligned at Phase 4 close (`runs/PHASE4_CLOSE.md`).

## Flagged ambiguities (unchanged handling)

1. Brief “prevention” vs contract catch-and-correct — build catch-and-correct; do not claim the pricing nudge prevented the miss.
2. Brief “beat” vs no beat-keying — key off evidence, never `beat === n`.
3. Attestation in registry vs Tier 3 — reread only; no attestation control; honest limitation if hit.
4. Beat 16 QA vs stretch — not built.
5. Advocate speech — **resolved:** timed stream + presenter-gated pauses.
6. Absolute yes — model + fixed clarification template; hedge is not consent.
7. Wrong-scope enrollment — C02 injection; main path metformin-only; no false success.
8. Do-not-call — **narrowed 18 Sep 2026:** no fake list-removal **action**; contact-preferences + playbook + NBA hard stop. Procedure text may exist in the knowledge set.
9. Five artifacts vs kickoff list — `SUBMISSION.md` **after M3**.
10. Six REST vs contract “no six integrations” — **overridden; recorded above.** Practitioner endpoint **dropped**. Coverage-review and telephony sit **beside** the six.
11. Corpus / governed FAST90 / query router — **overridden 18 Sep 2026; recorded above.** Later sessions must not restore a five-need routing table or a graph without Harish.

§15 remains authoritative for every fact, amount, ID, and disclosure string **on Harry’s call**.
