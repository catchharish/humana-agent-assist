# Humana Agent Assist prototype — standing rules

## Sources of truth
- `docs/humana_question_prompt.md` is the assignment. It wins any conflict.
- `docs/FINAL_PRODUCT_DECISIONS.md` is the product contract. Product behavior is already decided; do not reopen or "improve" it.
- Conflict order: Humana prompt, then contract §15, then §§10–14. Flag a real inconsistency to me; never resolve it silently.
- Never edit anything in `docs/`.

## What to read, what to ignore
- Build from the contract header (tiers, reading guide) and §§10–22. §15 is authoritative for every fact, amount, ID, and disclosure rule.
- §§2–9 and §§23–31 are presenter context. They add no build requirements.
- Never reintroduce a §29 rejected alternative.

## Scope
- This is a 2–3 day take-home prototype, not a production system. Choose the simplest thing that satisfies the contract.
- Tier 1 = build. Tier 2 = prove. Tier 3 = defined, NOT built. If a Tier 3 condition occurs at runtime, show an honest limitation, never a false state.
- Do not build the §23 stretch unless I ask.
- Do not add: quick ask, read retry, status check, attestation, outage handling, dashboards, graph retrieval, call-log mining, large corpora, auth systems, or persistence beyond the run log.
- The main call must run end to end before any replay or test work starts.

## Hard rules
- Required disclosure text comes byte-for-byte from the registry fixture. Never generate, reword, or "tidy" it. Nudge and status copy is fixed templates.
- The AI layer has no code path that can submit an enrollment, decide coverage, take payment, or give clinical advice. Hiding a button is not a boundary.
- No member data is displayed before the simulated authorization event.
- Nothing is keyed to a beat number or step index. Outputs must change when inputs change.
- Real, input-dependent AI is required for conversation interpretation, retrieval, answers, and wrap/handoff drafting. Telephony, transcript source, identity, and business systems are simulated and labeled as simulated in the UI and README.
- The test driver may supply transcript events, system results, and human actions. It may never inject the AI's classifications, answers, or badges.
- Evaluator reference answers live only under the test directory and must be unreadable by the running app.
- Any contract §21 hard failure blocks acceptance. Fix the cause; do not average it away or special-case the test.
- Record timing against the 1/2/5/8-second targets honestly. Never relabel a miss or pause the clock to hide one.
- Synthetic data only. No real member, provider, or claims data. No secrets in code; API keys come from environment variables.

## Session protocol — every new chat starts with no memory of earlier chats
- At the start of every session, before doing anything else, read `STATUS.md` and `PLAN.md` in the repo root, then the contract sections named there.
- `PLAN.md` holds the plan I approved (stack, real vs simulated, fixtures, architecture). Do not change it without asking me.
- Before you end a session, or when I say "wrap up", update `STATUS.md`: current milestone, what works, what is broken, the next three tasks, open questions for me. Keep it under 40 lines; replace stale content rather than appending.
- If `STATUS.md` and the code disagree, trust the code, fix `STATUS.md`, and tell me.

## Build order
- M0 — Plan approved and saved as `PLAN.md`.
- M1 — Walking skeleton: timed stream with partial/final/corrected events, five-region screen (§14), greeting verified quietly, no member data before the simulated authorization event.
- M2 — Full main call (§10, §20) end to end with me playing the advocate.
- M3 — Tier 2 proof: two fresh main-call runs, the six replays (§19.3), direct checks C01–C03 and C05–C06 (§19.4).
- Do not start M3 until M2 runs end to end. If time runs short, protect M2 over M3 and cut in the order of §10's "Time cap".

## When unsure
- Product behavior (consent, policy, authority, what counts as success): stop and ask me.
- Implementation detail: pick the simplest option and add one line to `DECISIONS_LOG.md` with the reason.

## Working habits
- Small changes. Run the app after each one and confirm the main call still works.
- Keep every acceptance run record, including failures.
- Keep `README.md` current: how to run the demo, what is real, what is simulated, known limitations.
- Cite the contract section you are implementing in commit messages or comments when it is not obvious.
