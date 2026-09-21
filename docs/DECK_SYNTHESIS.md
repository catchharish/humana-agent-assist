# Humana Agent Assist — deck and speaker-note synthesis

Plain-text source for the slides. Numbers marked (measured) came from your own runs.
Anything marked [YOU] needs your words or your facts. Check every claim against what
is actually built on the day — say "designed" where it is designed, "built" where it
is built.

---

## 0. The story in one breath
An advocate on a regulated call is doing five jobs at once from memory. This copilot
holds the call for them: it puts the right words on screen at the right moment,
catches a missed or paraphrased legal statement in seconds instead of weeks, answers
from the member's own records with every fact sourced, suggests a next best action
the advocate controls, and writes the after-call notes. The AI guides; the advocate
speaks and decides.

---

## 1. Problem brief

**User:** the recently ramped contact-center advocate (not QA). Design test used
throughout: *does this help them conduct the conversation, or is it one more system
to operate?*

**Problem:** no system holds the call — the advocate's working memory does. Exact
legal wording, facts spread across six systems, the right flow, objections, and
documentation, all while talking. A legal requirement is not a question anyone asks,
so a chatbot never surfaces it.

**Why now:** volume and scrutiny up, tenure down; QA samples a small share, so misses
surface weeks later; AI can now follow a live call and ground answers in member data.

**Opportunity — the claim is "catch and correct on the call", not "prevent".** The
product can show the wording on time, but it cannot stop a person speaking. What it
adds: detection in seconds, correction while the member is still on the line, and an
honest record.

**Primary measure:** legal-statement failures the member never heard corrected, per
applicable opportunity, independently reviewed. **Guardrails:** total failures must
not rise (no leaning on the nudge); handle time no worse; rereads and nudges per call
(member experience); false-nudge and skip rates (advocate trust). **Funding case:**
less searching, less after-call work.
Depends on Legal treating a late exact reading as better than none — stated as an
assumption.

**Outcome line for the demo:** without it, the pricing statement is never read and is
found weeks later only if the call is sampled. With it: caught in about a second, read
correctly before Harry decides, recorded honestly as "said late".

---

## 2. Service design (current → future)

| | Today | With the copilot |
|---|---|---|
| Before | Phone-menu hint, blank desktop | Reason for call shown with how we know it; nothing about the member until verified |
| During | Tab hunting, scripts from memory, dead air | One card telling them what to say or do now; facts pulled from the systems with sources; legal wording exact, checked in code |
| Objection / offer | Tenure-dependent | Humana-approved reply or tip from a playbook; advocate chooses |
| Regulated steps | Easy to blur | Enrollment, transfer, call outcome need a human click; AI has no path to them |
| After | Notes from memory, code guessed | Notes drafted from what actually happened, each line sourced; outcome suggested, advocate confirms; feedback captured |

---

## 3. The prototype

**Humana's four must-shows:** live call context · exact wording in flow · real-time
nudge on a miss (with the wording difference shown) · auto-written notes and handoff.
Also: detects why the member called, pulls member data, warm transfer.

**How it works — three inputs, two outputs.** After verification the member's
information is loaded through APIs. Every decision uses the member's information +
Humana's knowledge documents + the conversation so far. Outputs: answers, and a next
best action.

- The model decides where to look: a ready answer, the member-record APIs, document
  search, or a chain of lookups. No routing table in code.
- Every statement cites a source; code checks the source was really retrieved and
  contains the fact. Unsupported statements are removed or marked "not confirmed".
  Click a source tag to see the snippet.
- Suggestions come from playbook documents, not code. A new offer = a new document.
- Seven hard stops in code: not verified; legal statement due; already enrolled; said
  no; do not contact; already skipped; relies on an unconfirmed fact.
- Legal wording is never written or judged by a model: copied from a governed
  registry, matched by code, once per call, a finding that cannot be overwritten.
- When the model fails, the screen says so. It never fakes an answer.

**Real vs simulated:** the AI is real. Telephony, identity and the six business
systems are simulated APIs with made-up data (five members, about fourteen documents).

**Humana's table, as built**

| AI on its own | AI suggests, advocate chooses | Human only |
|---|---|---|
| Shows the next step; checks legal wording; catches a miss; drafts notes | Replies to a concern; tips and offers; warm transfer; call outcome | Submit enrollment (one-time token tied to what was read back); no coverage decisions, payment or clinical advice — ever |

The end-of-call screen tallies the call in these three columns.

---

## 4. Key decisions and the paths not taken

| Decision | Instead of | Why |
|---|---|---|
| Advocate as user | QA / team lead | The miss happens on the call; fix it there |
| "Catch and correct" | "Prevent" | Only claim what the demo proves |
| Legal wording in code | Model judging wording | "String match against the registry" beats "the AI thought so" |
| Model reasons and calls APIs for any member, any question | A scripted five-question demo | [YOU: "it cannot be a Figma demo"] |
| Per-statement sources + a support check | Trusting fluent answers | A citation is not authority unless the fact is in the source |
| Offers in playbook documents | Offer rules in code | Content separate from workflow; Legal/ops can own it |
| Per-system APIs as the only data path | One convenient data file | Mirrors the six-system reality; one governed source feeds many channels |
| Chained lookups now, graph later | Building GraphRAG up front | Tested 10 multi-step questions: 10/10, no failure from a missed link (measured) |
| Ready answers generated from documents, tied to their source | Hand-written FAQ answers | Fast, but never stale or canned |
| One pair of thumbs + reasons on every AI output | No feedback loop | How the product improves after launch |
| Two views: advocate / behind the scenes | One busy screen | Advocates need calm; reviewers need proof |

---

## 5. The one key tradeoff
**Recommended headline: "Obligations loud, optional help quiet."** Legal statements
take the whole screen the instant they are due; tips and offers wait, show one at a
time, and may never be shown. Cost: some helpful suggestions arrive late or not at all,
and some enrollment opportunities are missed. Why: an advocate who is interrupted by a
wrong or badly timed tip stops looking at the panel — and then misses the statement
too. It carries into the roadmap (suggestions start in shadow).

**Hold in reserve — flexibility vs speed** (architecture judgment, with numbers):
letting the model reason instead of scripting routes made the flagship answer slower
(about 6.5 s) — then recovered to about 1.8 s by loading member information up front,
short answers, and a faster service tier; per-statement sources cost about 1.8 s of
that back. (measured) [YOU choose which is the named tradeoff.]

---

## 6. Architecture stories worth telling

**Latency is a product decision.** Cold model call 2.7 s; warm median 0.9 s with 4 of
10 over one second; there is a floor of about 0.7 s on any hosted-model round trip.
So the compliance path cannot depend on a model call: clear cases run on governed
rules in code and paint in about 10 ms; only ambiguous cases go to a small model, sent
twice on the fast tier (median 0.88 s, 2 of 20 over one second). Misses are logged,
never relabelled; targets stayed at 1 / 2 / 5 / 8 seconds. In production: a small
classifier hosted next to the call stream. (measured)

**What building with a coding agent taught me.** Left alone, the agent fitted the
build to the script — hardcoded amounts, scripted sentences disguised as "rules", a
router that knew five questions, a fake answer when the model failed. The fix was
process: general fixes only, questions the agent never sees, behaviour-based tests,
and my own click-through, which caught what the tests did not.

**Honest failure.** A billing outage exposed that failures were being papered over.
Now: a plain "could not answer — retry", and an AI-connection indicator for the
presenter.

---

## 7. Roadmap (order and reason)

| Phase | What | Why this order |
|---|---|---|
| 0 Prototype | One call family, made-up data | Only place to show everything with no member risk |
| 1 Bounded pilot | Legal-wording checks and sourced answers live; suggestions run silently in shadow and are logged | Exact text and records are checkable; early wrong suggestions cost trust that is slow to win back; shadow data gives a measured baseline |
| 2 Deeper help | Suggestions on where shadow data supports it; more ready answers chosen from real call data; feedback and skip reasons tune playbooks; after-call QA from the same registry (Humana's stretch) | Needs Phase 1 evidence and approved content |
| 3 Wider | More call types, teams, channels | Reuse only after patterns hold in one operation; each needs its own governed content |
| Later | Classifier next to the call stream; graph only if multi-step tests fail; pre-loading learned from logs | Evidence-gated |

---

## 8. Assumptions (say them out loud)
Members: made-up data; consent means a clear yes to one scoped question. Advocates:
will ignore a panel that is slow or noisy. Data: the six systems expose what the
simulated APIs return; Legal owns the wording and its rules. Constraints: a late exact
reading is better than none; Humana's desktop can host an embedded screen that opens
on call connect (prototype is a standalone page standing in for it).

## 9. Experience that shaped it [YOU — fill with your own facts, no overclaiming]
- GoHealth: Medicare agents on regulated calls; newer agents; what cut call time.
- interface.ai: conflicting knowledge sources; a citation is not authority; ownership
  and governance of content.
- Your own sales copilot: latency, placement on screen, what users ignore.

## 10. What I would do next / differently
Next: the unscripted evaluation set (run three times each); real speech recognition;
validate rules with Legal; shadow pilot. Differently: fix the information hierarchy of
the screen before the logic; gate every change with off-script questions from day one;
measure latency before designing around a model call.

## 11. Demo plan
Main Harry call plays on its own; you pause when you want. Show: the missed pricing
statement and the wording difference; the sourced $8 vs $27 answer; a tip; enrollment
needing your click; transfer; End call → notes → review of the AI. Then switch member
or pick a question from the menu. Have a recorded run ready. If an answer is slow, say
why — that is the latency story.

## 12. Before you present — open items
Screen redesign and the "nothing needed" fix (in progress); evaluation set and code
review (not started); after-call QA scorecard (not built — say so); billing alert set;
check the public repo and README read well.
