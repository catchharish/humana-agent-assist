# C06 — Visible interaction / flow (manual)

Must be re-walked on an **interactive T01** after the 18 Sep review fixes. Prior ticks on T02A/T04B are stale for due-now vs answer (F12) and source inspection.

Walked 18 Sep 2026 on `http://localhost:3005/` session `runs/b3863f9e-f6b0-408b-a609-75980c417c80.jsonl` (due-now item). Earlier identity/disposition ticks: `runs/10bc0f4b-500e-4872-b60b-a7477830ec48.jsonl` on `:3004`.

- [x] Call strip changes on evidence (interactive T01: Unverified → Harry Whitfield · pharmacy_ops · VALID).
- [x] Due-now wording outranks the answer (T01 Now stays on the pricing statement while a late refill/historical card is ready). At “Six quotes loaded”: Now = exact DEMO-PRICING-v1; rail Due now; quotes **ready, demoted** in the context drawer with $15 still visible; Clarify gone after `e-yes-compare`.
- [x] Pending-later closing does not outrank the Now answer.
- [x] Source labels resolve by opening the record (`View evidence` shows the Now-card body, not only a label string).
- [x] Unresolved work remains accessible (open-needs list + Make this the focus). Unrecognized questions block COMPLETED_SERVICING. *(Open needs + focus buttons seen. Unrecognized-question → not COMPLETED_SERVICING not re-probed this walk; T01 ended TRANSFERRED_COVERAGE_REVIEW after Confirm.)*
- [x] Disposition needs a human Confirm click.
- [x] No member name/plan before the simulated authorization event.
- [x] Replay buttons T02A–T08B load the matching stream. *(UI sampled Replay T02A — “Pretty nice weather…”. Other five passed automated `tests/replays.test.ts` on :3004.)*
- [x] Keep the interactive T01 jsonl under `runs/`.

Automated T01 (`RUN_T01=1 npm run test:t01`) is not a C06 pass.
