# Playbook v2 suggestion check — 20 Sep 2026

Documents only. No code, no hard stop, no named member in playbooks.

- `DEMO-PLAYBOOK-OFFERS-v2` and `DEMO-PLAYBOOK-NINETY-DAY-RETAIL-v2` add: do not offer retail-versus-mail comparison for a medicine already received as 90-day mail-order; if all current medicines are already filled that way, nothing to offer.
- App restarted: one `next dev` on `:3000`.

## Luis (M005) × 5

File: `runs/playbook_v2_luis5_harry5.json`

**5/5 `none`**, source `model`. Playbook id on the proposal: `DEMO-PLAYBOOK-NONE-v1`. Reasons name the confirmed 90-day CenterWell / preferred-mail fill. Every run rejected `optional_comparison` because the medicine is already a 90-day mail-order supply (paraphrase of the new exclusion, not a byte-for-byte quote). Sessions: `009d1ca6-…`, `ccc6e7e1-…`, `d9c1…` (see JSON).

## Harry (M001) × 5

Same file. **Expected** last recorded suggestion `optional_comparison`. **Got** `preferred_pharmacy_tip` **5/5** (`DEMO-PLAYBOOK-PREFERRED-PHARMACY-v1`). Terra rejected comparison as unnecessary given confirmed preferred vs standard retail fills. This is a miss vs “same suggestion as before.” Record kept; no code change.

## Five-member proof once

`ORIGIN=http://127.0.0.1:3000 npx vitest run tests/nba_members.test.ts` — **pass** (42s). Harry a non-none proposal (`preferred_pharmacy_tip`); M002 `already_enrolled`; M003 `do_not_contact`; M004 `other_plan_cost_explain`; M005 model `none`. Latest: `runs/nba_members_latest.json`.
