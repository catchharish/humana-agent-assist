# C06 — Visible interaction / flow (manual)

Inspected 18 Sep 2026 on http://localhost:3000 (T02A presenter path + T04B due-now). Log success alone is not a UI pass.

- [x] Call strip changes on evidence (T02A: Unverified → Harry Whitfield · pharmacy_ops · VALID; need → refill status).
- [x] Due-now wording outranks the answer (T04B Now title is "Pricing statement due now" with DEMO-PRICING-v1 verbatim; quote table is below, not the title).
- [x] Pending-later closing does not outrank the Now answer (closing rail stays pending/not applicable while Now shows the servicing or due-now card).
- [x] Source labels resolve (`System record · pharmacy · simulated`, `Governed guidance · scripting · simulated`, eligibility after auth).
- [x] Unresolved work remains accessible (open-needs list + Make this the focus).
- [x] Disposition needs a human Confirm click (`Confirm COMPLETED_SERVICING` → `Confirmed COMPLETED_SERVICING`; outcome line stayed `unconfirmed` until that click).
- [x] No member name/plan before the simulated authorization event (Context withheld until Resume after DEMO-AUTH001).
- [x] Replay buttons T02A–T08B load the matching stream.

Automated T01 (`RUN_T01=1 npm run test:t01`) passed 18 Sep 2026 (~90s). Presenter Resume + human Confirm exercised in the UI on T02A.
