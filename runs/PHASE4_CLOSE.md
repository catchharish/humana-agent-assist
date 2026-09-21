# Phase 4 close — 20 Sep 2026

Wrap-up only. No new call flow, no §23 stretch, no 3× packs, no graph, no commit.

## What Phase 4 is

Interview packaging and honesty: how to run, what is real vs simulated, limitations, architecture, current demo (including Open call), PLAN as-built if the running product drifted, SUBMISSION aligned to what was built, secrets scan.

## Artifacts

| File | What changed |
|---|---|
| `README.md` | How to run, Open call vs Harry lock, advocate vs presenter chrome, Terra (not query routing), honest limits, architecture, evaluator isolation |
| `SUBMISSION.md` | Five artifacts + thinking aligned to as-built; proof dates honest; tradeoff not beat-keyed |
| `PLAN.md` | Dated **As-built (20 Sep 2026)** addendum; approved 17–18 Sep overrides left in place |
| `STATUS.md` | Phase 4 closed; next is Harish manual test |
| `DECISIONS_LOG.md` | This close |
| `AGENTS.md` | Seventh NBA stop (`unconfirmed_fact`) in the standing hard-stop list |

Did not edit `docs/`.

## As-built drift that packaging had to catch

- Demo is not “beats 0–15.” Scripted T01/replays are Harry; **Open call** is unscripted after greeting + auth.
- Live answers are **Terra tool loop**, not a five-need `routeQuery` table (`lib/queryRouter.ts` deleted 19 Sep).
- NBA hard stops in code are **seven**, including `unconfirmed_fact`. Luis “none” is model-reasoned.
- Due-now wording occupies Now; paraphrase word-diff is advocate help.
- Disposition is Terra from `DEMO-DISPOSITIONS-v1` with safety gates only.

## Proof this wrap does **not** re-claim

Phase 4 did not re-run T01, replays, chain, not-canned, or NBA.

Latest narrative: `runs/PHASE3_REPORT.md` plus its follow-up section.

| Suite | Combined 3× pack | Follow-up (once, after Open call / T06A wait / NBA log) |
|---|---|---|
| T01 | 3/3 | pass once |
| Six replays | 1/3 (T06A wait) | 6/6 once |
| Chain | 3/3 of 10/10; c02 run 1 **9647 ms** over 8s | not run |
| Not-canned | 3/3 | not run |
| Five-member NBA | 2/3 (Luis proposed comparison) | pass once (Luis `none`) |

Failed JSONL from the combined pack is kept. Do not average the 1/3 and 2/3 into a pass.

C01–C03 and C05 last recorded as pass 18 Sep (M3). C06 last formal interactive tick 18 Sep; Phase 3 screenshots cover due-now occupancy and paraphrase-diff. Automated T01 is not a C06 pass.

Graph: do not build. 19 Sep chain eval was 10/10 under 8s. Later 8s miss is load.

## Secrets scan

**Rule:** never copy a live key into this file, STATUS, README, SUBMISSION, or chat.

**What is gitignored**

- `.env` — confirmed `git check-ignore`: `.gitignore:3:.env`. Local file exists for runtime. **Do not commit it.**
- `runs/*.jsonl` — default ignore. Ready-answer cache `.cache/` ignored.

**What is tracked**

- `.env.example` — `OPENAI_API_KEY=` empty placeholder plus model id names. Not a secret.
- Two historical run logs (force-added despite the ignore): `runs/00d1a1b6-2612-4d6c-bd86-8c612a6def36.jsonl`, `runs/f65459fe-8069-4cfc-9419-afdbab2e1dbf.jsonl`.

**Scan method (20 Sep)**

- Patterns: `sk-` / `sk-proj-` / `sk-svcacct-` shapes; `OPENAI_API_KEY=` assignments; `.env` contents vs git tracking.
- Scope: git-tracked files, then local `runs/*.jsonl` (gitignored), without printing match values.

**Hits**

| Location | Kind | Action |
|---|---|---|
| `.env` (untracked) | live `OPENAI_API_KEY` | remains gitignored; value not copied here |
| `.env.example` | empty assignment | keep |
| `lib/openai.ts` | reads `process.env.OPENAI_API_KEY` / parses `.env` lines | keep; no literal key |
| `old/FINAL_PRODUCT_DECISIONS_A.md` | false positive: `task-appropriate` matches `sk-appropriate` | ignore |
| Tracked `runs/*.jsonl` | none | keep as historical evidence |
| Local gitignored `runs/*.jsonl` | none | — |

No live key in tracked source, fixtures, tests, README, SUBMISSION, or PLAN.

## App state

Leave the running Next process idle for Harish’s manual test. Phase 4 did not start, stop, or rebuild it.
