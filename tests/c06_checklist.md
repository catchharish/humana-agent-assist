# C06 — Visible interaction / flow (manual)

Must be re-walked on an **interactive T01** after the 18 Sep review fixes. Prior ticks on T02A/T04B are stale for due-now vs answer (F12) and source inspection.

- [ ] Call strip changes on evidence (interactive T01: Unverified → Harry Whitfield · pharmacy_ops · VALID).
- [ ] Due-now wording outranks the answer (T01 Now stays on the pricing statement while a late refill/historical card is ready).
- [ ] Pending-later closing does not outrank the Now answer.
- [ ] Source labels resolve by opening the record (`View evidence` shows the Now-card body, not only a label string).
- [ ] Unresolved work remains accessible (open-needs list + Make this the focus). Unrecognized questions block COMPLETED_SERVICING.
- [ ] Disposition needs a human Confirm click.
- [ ] No member name/plan before the simulated authorization event.
- [ ] Replay buttons T02A–T08B load the matching stream.
- [ ] Keep the interactive T01 jsonl under `runs/`.

Automated T01 (`RUN_T01=1 npm run test:t01`) is not a C06 pass.
