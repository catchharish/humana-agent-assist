# Phase 3 — advocate view audit (demo details off)

**When:** 20 Sep 2026  
**Where:** `http://127.0.0.1:3000/` T01, Show demo details **unchecked**  
**Browser:** Cursor tab `11d600`

Expected with the toggle off: no registry/authorization IDs, no “simulated” / source-system lines, no obligation design notes, no diagnostics, no timing internals, no event IDs. Pause/Resume stay in the demo bar. Member facts only after simulated auth.

## Idle (before Start)

| Check | Shown | Result |
|---|---|---|
| Demo details | Unchecked | Pass |
| Caller | Not verified | Pass |
| Now | Opening / Start the call… | Pass |
| Context | Member details appear after the caller is verified | Pass |
| DEMO-* / simulated / event ids | None | Pass |

## Before authorization (after Start)

| Check | Shown | Result |
|---|---|---|
| Now | Verify the caller's identity; phone-menu refill hint | Pass |
| Context | No member name/plan | Pass |
| Greeting chip | Due now, then Said | Pass |
| Harry in advocate regions | Only in presenter Member selector | Pass |
| Resume | In demo bar, not on Now | Pass |

## After authorization

| Check | Shown | Result |
|---|---|---|
| Caller | Harry Whitfield · MAPD | Pass |
| DEMO-* / simulated / event ids | None on strip | Pass |
| Source tags | “Pharmacy system” short tags only | Pass |

## Pricing due

| Check | Shown | Result |
|---|---|---|
| Pricing chip | Said late | Pass (late is honest) |
| Now | Exact pricing statement + “Wording differs” | Pass for exact text |
| Heard / Missing / Extra word-diff | Was visible with details off | **Fail, then fixed** — now gated on demo details |
| Open-needs flow | `educate (derived DEMO-FAST90-v1)` | **Fail, then fixed** — IDs stripped when details off |
| Luna / Terra health in demo bar | Visible with details off | **Fail, then fixed** — presenter diagnostics only with details on |
| Quote amounts on Now while due-now is showing | $6 / $24 / $15 statements under the pricing card | Noted: due-now title is present; comparison amounts also paint on Now. Not changed this pass (behavior, not chrome). |

## Not probed this walk

Full T01 to disposition Confirm; T02A–T08B with details off (automated replays **3/3** after the quote-correction / date-atom fixes).
