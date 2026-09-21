# Humana Agent Assist (prototype)

Standalone web page standing in for an **embedded** advocate call desktop ([contract §14](docs/FINAL_PRODUCT_DECISIONS.md)). Not a chat panel and not a typed-question chatbot.

**What this is.** A 2–3 day take-home: live call context, exact required wording in-flow, a real-time nudge when wording differs, sourced answers, optional next-best-action, wrap and handoff drafts. Product behavior is already decided in the contract; this repo implements it.

**What this is not.** Production Agent Assist. Not Legal-approved Humana policy. Not a measured compliance lift.

Five Humana artifacts (problem, service design, prototype, roadmap, tradeoff) are in [`SUBMISSION.md`](SUBMISSION.md). How we built it is in [`PLAN.md`](PLAN.md). Why we chose each path is in [`DECISIONS_LOG.md`](DECISIONS_LOG.md).

---

## How to run the demo

```bash
cp .env.example .env   # paste OPENAI_API_KEY; never commit .env
npm install
npm run build && npm start
```

Open http://localhost:3000.

`npm run dev` also works (port 3000). Prefer `build` + `start` when presenting so the Next.js dev overlay is not on screen.

### Presenter demo bar (top strip)

| Control | What it does |
|---|---|
| **Scenario** | **Open call** — greeting + identity, then you drive. **Main call (T01)** — Harry’s §15 story. **Replay T02A–T08B** — six contrasts. |
| **Member** | Open call: any of five (Harry, Mina, Owen, Priya, Luis). Scripted scenarios **lock to Harry** and say so on the bar. |
| **Start / Resume** | Start plays the scenario stream. Resume is a presenter pause, not identity. |
| **Show demo details** | Off by default (advocate view). On: IDs, simulated source-system lines, diagnostics, event ids, model error text. |
| **Luna / Terra dots** | Always visible in this bar (green / red / gray). Error reason only with demo details on. Never in the advocate columns. |
| **Caller says… / You say… / Try a question / End call** | Presenter speech and hang-up. Same ingestion path as the timed stream. |

**Advocate columns** (call strip, obligations, Now, context, transcript): member fields appear only after simulated authorization. While a required statement is due, Now is that exact wording only. A paraphrase of required wording shows what was said / missing / added next to the text to read — that is advocate help, not a demo-details extra.

### A 10-minute walk

1. **Open call**, pick **Luis** (or Mina / Priya). Start. Greeting is verified quietly. Authorization returns VALID for that member. Type a question. End call. Wrap and a disposition recommendation should follow. This is the “not canned” proof.
2. **Main call (T01)**, Harry. Resume at pauses. Pricing due-now occupies Now (no quote amounts on that card). Confirm transfer and disposition yourself — the model recommends; it does not write the code.
3. Leave **Show demo details** off unless you are explaining internals.

### Tests (app must already be up)

```bash
ORIGIN=http://127.0.0.1:3000 npm test          # unit + live replays if origin answers
ORIGIN=http://127.0.0.1:3000 RUN_T01=1 npm run test:t01
```

The test driver may supply transcript events, system results, and human clicks. It never injects the AI’s classifications, answers, or badges. Evaluator reference answers live only under `tests/` (ESLint blocks `app/` and `lib/` from importing them).

---

## What is real vs simulated

| Real (input-dependent models + code) | Simulated and labeled |
|---|---|
| Conversation interpretation (Luna), disclosure **trigger** classification, Terra tool loop, ranked SEARCH, ready-answer lookup, answer / wrap / handoff / NBA / disposition **drafts** | Telephony / ASR / IVR, identity, benefits, claims, pharmacy, provider, scripting store, coverage-review **read**, transfer connection |

Mandatory disclosure **text** is copied byte-for-byte from `GET /api/simulated/scripting/disclosures`. Exactness, timing, and nudge copy are **code**. The model does not write or judge required legal wording.

**Two-stage pricing trigger:** stage 1 is registry-pattern code (never historical charges; never retract a fired nudge); stage 2 is `gpt-5.6-luna` on ambiguous partials. The 1-second target is the code path. Luna interpret often misses 1s; misses are recorded honestly.

**Enrollment:** human Confirm mints a one-time server token bound to read-back scope; `POST /api/simulated/pharmacy/enrollments` is **403** without an unused matching token. AI tools cannot mint or submit. Coverage determination, payment, and clinical advice are never tools.

**Quotes:** no prospective amount on any card until comparison consent is a clear yes.

**Disposition:** Terra recommends one code from `DEMO-DISPOSITIONS-v1` with cited reasons. Code only **blocks**: any code before an end trigger; transferred without a confirmed connection; enrolled without a confirmed enrollment result. The advocate still clicks Confirm.

---

## Architecture

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

Evidence labels look like `System record · pharmacy · simulated` (full form with demo details on).

**Recorded override (Harish, 17 Sep 2026):** simulated REST is the only retrieval boundary. App/lib do not import fixture JSON for answers. Handlers live at `/api/simulated/{benefits|eligibility|claims|pharmacy|provider|scripting}` plus telephony and coverage-review **beside** the six. See [`PLAN.md`](PLAN.md).

Payloads are **illustrative shapes — real integration maps to Humana's APIs.** Harry’s values come only from contract §15. Extra members are labeled simulated/made-up and do not overwrite Harry.

**Recorded override (Harish, 18 Sep 2026):** the **model routes**. There is no five-need `routeQuery` table. Terra chooses tools; the session binds `memberId` / `planId`. Ready answers are generated from documents (gitignored cache). A 10-question chain eval completed under 8s on the recorded run; **do not build a graph** unless that decision is reopened.

Models: fast `gpt-5.6-luna` (`reasoning.effort: none`); mid `gpt-5.6-terra`; embeddings `text-embedding-3-small` (documents once at startup; query only per SEARCH).

The live page receives session updates over **server-sent events** (`GET /api/session/events`).

---

## Evaluator isolation

`tests/` must not be imported by `app/` or `lib/`. Guard: ESLint `no-restricted-imports` (lint failure), plus webpack alias `tests: false`. Not a comment-only rule.

---

## Known limitations (honest)

- Stretch / post-call QA view is **off** (contract §23).
- Tier 3 (quick ask, attestation, read retry, unknown-write status, outage dashboards) is **not built**. Those conditions show a limitation, never a fake success.
- Luna per-utterance interpret often misses the **1s** target. Stage-1 triggers, exactness, and utterance rules are the 1s-safe path.
- The **8s** answer target can miss under load (example: chain c02 9647 ms in `runs/PHASE3_REPORT.md`). Misses stay misses.
- Next-best-action “none” for a member who already fills 90-day preferred mail is **model-reasoned** from playbook text, not a member-id rule. Hard stops in code are identity, due-now wording, already enrolled, said no, do-not-contact, dismissed-this-call, and unconfirmed fact.
- Scripted T01 / replay streams are Harry’s call. Open call is how other members are driven live.
- C06 is a **manual** UI checklist (`tests/c06_checklist.md`). Automated T01 is not a C06 pass.
- In-memory sessions (cap 64). JSONL under `runs/` (gitignored except two historical files). Ready-answer cache is gitignored.
- This is not NCPDP-, CMS-, or FHIR-compliant. Paths are not real Humana hosts.

Failed acceptance runs are kept on purpose. Latest proof narrative: [`runs/PHASE3_REPORT.md`](runs/PHASE3_REPORT.md). Secrets scan: [`runs/PHASE4_CLOSE.md`](runs/PHASE4_CLOSE.md).
