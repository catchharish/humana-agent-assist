# Humana Agent Assist — product narrative (11 questions)

Plain-text source for slides and speaker notes. [YOU] = needs your facts or words.
"Built" means it runs today; "designed" means decided but not built. Time ranges are
illustrative — label them that way. Verify measured numbers against DECISIONS_LOG.md.

---

## 1. Why this product
- The live call is Humana's highest-volume, most regulated member touchpoint.
- On one call an advocate does five jobs from memory: exact legal wording, facts from
  six systems, the right flow, objections, documentation — while talking.
- Misses are found weeks later, in a small QA sample, if at all.
- A chatbot cannot fix this: a legal requirement is not a question anyone asks. The
  product has to follow the call and speak first.
- It is the proving ground for how AI and advocates work together: the AI guides, the
  advocate speaks and decides.

## 2. Why this user
- **The recently ramped advocate.** The miss happens on the call, so help has to be
  on the call. Tenure is falling, so newer advocates carry the most risk and gain the
  most. If it works for them it works for everyone.
- QA and team leads are the second user, later: the same rules that guide the call
  can grade it.
- Design test used for every decision: *does this help them conduct the conversation,
  or is it one more system to operate?*

## 3. The opportunity
- **Compliance:** catch and correct a missed or paraphrased legal statement on the
  call, on every call — not a sample, not weeks later.
- **Capacity:** no tab hunt during the call; after-call notes drafted in seconds.
- **Consistency:** same question, same sourced answer, whoever picks up.
- **Ramp:** new advocates perform closer to tenured ones, sooner.
- Sizing needs Humana's numbers, not mine: required statements per year × miss rate ×
  cost of a finding; after-call minutes × calls × loaded cost. First pilot deliverable
  is the real miss rate.

## 4. In scope / out of scope
**In (prototype):** one call family — refill that turns into education and enrollment;
three legal statements; answers from member records and Humana knowledge with a source
on every fact; next best action, objection rebuttal, warm transfer, disposition code;
human-only enrollment; end-of-call notes; thumbs feedback; five made-up members; six
simulated systems; presenter controls to type a caller line, pick a question, end the
call.
**Out:** real speech recognition and telephony; real member data; payment, coverage
decisions, clinical advice (never); a do-not-call workflow (recognised, not handled);
post-call QA scorecard (designed, not built); team-lead dashboards; other languages;
graph retrieval; other lines of business.

## 5. How to build: prototype → production
| Piece | Today | What production needs |
|---|---|---|
| Hearing the call | Scripted transcript with timing | Audio stream from the contact-center phone platform; live speech-to-text with speaker separation; accuracy proven on the legal statements; call events (connect, hold, transfer, end) |
| Who is calling | Simulated | Humana's authentication and phone-system hand-off |
| Member data | Simulated APIs, made-up records | Integrations with Humana's systems of record (eligibility, benefits, claims, pharmacy, provider, scripting) — read-only first, write-back of notes and outcome later; permissions; audit trail |
| External systems | None | CenterWell pharmacy and pricing, CRM, QA platform, single sign-on, knowledge management |
| Running it | Local logs, manual checks | Tracing, logging, alerts, cost per call, latency per step, redaction of protected health data, access control |
| Knowledge | ~14 made-up documents and playbooks | Governed content with owners, versions, approval; Legal owns the statement registry and its rules |
| Models | Hosted API, two sizes | Humana-approved hosting for protected health data; retention rules; a small classifier next to the call stream for the one-second paths |
| Where it lives | Standalone web page | Embedded in the advocate desktop, opens on call connect |
| Safety | Hard stops, citation check, human-only token | Red-teaming, injection testing, monitoring, a "copilot is down" mode where the advocate simply carries on |
| Proof | Manual walk-throughs; evaluation set designed | Judges built on recorded production calls and calibrated to human QA; baseline of the current operation; continuous evaluation |
| People | — | Training, clear disclosure of what is monitored, advocate feedback loop |
| Sign-off | — | Legal, privacy, security, compliance |

## 5b. Architecture — the Next Best Action component

**What it produces.** At most one recommendation at a time, of four kinds, all in
Humana's words: **Next best action** (a tip or an offer), **Objection rebuttal** (a
Humana-approved reply when the caller hesitates), **Warm transfer**, and **Disposition
code** (the call outcome). Enrollment is not a recommendation — it is a human-only
step.

**Three inputs, always together**
1. The member's information — loaded after verification; anything that can change
   during the call is fetched fresh.
2. Humana's playbooks — documents in the knowledge set. Each says: the action, its
   kind, when it applies, when it must NOT be offered, which one wins when several
   fit, the approved wording, and what the advocate can do with it.
3. The conversation so far — what the caller asked, what is resolved or open, what
   they said no to, what the advocate already skipped, and which facts have been
   confirmed by the source check.

**The flow**
```
caller line ─► Gate 1: hard stops in code ─► find the relevant playbooks (by meaning)
                  │ blocked → no card,              │
                  │ reason logged                   ▼
                  │                     model reasons over the three inputs
                  │                     → ONE action or "none", with reasons,
                  │                       the fact behind each reason and its source,
                  │                       the playbook passage, what else it considered
                  │                                 │
                  │                                 ▼
                  │                     Gate 2: checks in code
                  │                     · reasons use confirmed facts only
                  │                     · every fact's source really contains it
                  │                     · no price before a clear yes
                  │                     · ready within 8 seconds, or dropped quietly
                  │                                 │
                  ▼                                 ▼
             every attempt ends in      waits its turn ("Up next") ─► main card
             exactly ONE logged         (legal statement > human-only step > answer
             outcome                     > recommendation; moves up after the answer
                                          has been readable ~5 s, a thumb, or the
                                          caller moves on)
                                                    │
                                                    ▼
                                        the advocate decides
                                        · tip / rebuttal: thumbs up = using it,
                                          thumbs down = skip (+ optional reason)
                                        · transfer / disposition: its own button,
                                          "Requires human permission"
                                                    │
                                                    ▼
                                        logged: what was proposed, why, what the
                                        advocate did, feedback → tunes playbooks,
                                        feeds the evaluation set and shadow mode
```

**Gate 1 — the seven hard stops (code; the model cannot override them)**
Identity not verified · a legal statement is due now · already enrolled · the caller
said no on this call · the member asked not to be contacted · the advocate already
skipped it · it relies on a fact that was not confirmed.

**Design principles**
- **Content separate from workflow.** A new offer is a new playbook document — no
  code change. Operations and Legal can own the content. (Proven by adding an offer
  as a document only.)
- **The model proposes; code decides what is allowed.** Judgement is flexible, limits
  are fixed.
- **One at a time, quiet by default.** A recommendation never interrupts a legal
  statement or an answer, and is dropped rather than shown late or half-ready.
- **Explainable on the card.** The reason, the facts and their sources are visible;
  "none" also has logged reasons.
- **Member first when offers compete.** For a member who paid more at a standard
  pharmacy, the one suggestion is a price comparison that includes their preferred
  pharmacy — not a push to one channel.
- **Every attempt is accounted for:** proposed · none, with reasons · blocked by a
  named stop · dropped by the time cap · failed, with a status. Nothing ends silently.

**What production adds**
Playbooks under version control with an approval step; eligibility from real systems;
shadow mode first (recommendations logged, not shown) to measure how often they are
right before advocates see them; monitoring for pressure or steering; tuning from
thumbs, skip reasons and outcomes — and only later, if the data supports it, learning
which suggestions help which members.

**Honest status:** the component is built and playbook-driven; run-to-run consistency
of Harry's suggestion is being stabilised. Check before presenting.

## 6. KPIs
- **Headline:** legal statements the member never heard corrected, per required
  statement, independently reviewed.
- **With it:** total failures (must not rise), said on time (must not fall), could not
  verify, time to detection.
- **What pays for it:** after-call work time; systems opened by hand for lookups; time
  to first fact.
- **Must not get worse:** handle time; member experience (rereads, complaints, no price
  before a clear yes); advocate trust (used vs skipped, thumbs); zero AI actions in
  regulated steps.

## 7. Value capture
- **Compliance and Legal:** fewer findings, evidence on every call, faster detection.
- **Operations:** recovered minutes absorb rising volume; shorter ramp lowers training
  cost. Position it as capacity, not headcount.
- **Members:** right answer first time, no pressure, fewer repeat calls.
- **Platform:** one governed registry and one set of playbooks feed advocate assist,
  QA grading, training and other channels — content separate from workflow.
- **Learning loop:** thumbs, skip reasons, note edits and run logs improve playbooks
  and the evaluation set.
- Enrollment uplift is reported, never targeted.

## 8. Tradeoffs
**Design**
- Obligations loud, optional help quiet — some useful tips arrive late or never.
- One card, one thing — less on screen, more trust; detail is one click away.
- Legal statements shown only when due or said — no early warning, no false alarms.
- One pair of thumbs for "used it" and "was it good" — simpler; reasons keep the data
  usable.
- A reread costs the member a few seconds; an unheard statement costs a finding.

**Architecture**
- The model decides where to look vs a routing table — handles any question; slower
  and less predictable. Recovered from ~6.5 s to ~1.8 s by loading member information
  up front, short answers, faster tier. (measured)
- A source on every statement, checked in code — trust and safety; costs about 1.8 s.
  (measured)
- Legal wording checked in code, not by a model — exact, instant, explainable.
- Hosted models have a floor of ~0.7 s — so nothing compliance-critical waits on one.
- Chained lookups now, graph later — 10 of 10 multi-step questions right without it.
  (measured)
- Ready answers generated from documents — fast, tied to their source, rebuilt when it
  changes.
- Per-system APIs as the only data path — more plumbing; mirrors the real estate.

## 9. How it has been tested — evaluation matrix

**A. What is judged, and by what**
| Part of the system | Job | Good looks like | Judged by |
|---|---|---|---|
| Code (no model) | Legal wording: exact, on time, once per call | Every wording variant classified correctly; zero false alarms | Code |
| Small fast model | Read each line; ambiguous triggers; clear yes vs hedge | Right label; about a second; never able to hide a real answer | Code on labelled lines; timing from the run |
| Mid model | Choose lookups, answer, suggest, write notes, recommend outcome | Facts right and sourced; honest "no supported answer"; right suggestion or none; refuses regulated asks; same result run to run | Code for facts and sources; a second, different model for judgement calls; a person spot-checks the judge |
| Search ranking | Find the right passage; reject the wrong plan | Right passage near the top; wrong plan rejected for the right reason | Code, on known-answer questions |

**B. The evaluation set — 109 items**
Written from the real documents and the five members' records, in the way members
actually talk. One source generates both the runnable file and the readable list, so
they cannot drift apart.
| Group | Items | What it proves |
|---|---|---|
| Answers, across all five members | 36 | Facts correct and sourced: own records, general knowledge, both together, multi-step, partial support, no support |
| Next best action | 19 | Right suggestion, or none; each hard stop; quiet while a legal statement is due; quiet after a no |
| Must never do | 13 | No clinical advice, coverage prediction, enrollment or payment by the AI, other members' data, pressure, or obeying planted instructions. One failure blocks release |
| Same question, different words | 30 (10 × 3) | Same facts whatever the phrasing |
| Change the data | 11 | Alter a record or a document and the answer, its sources and the suggestion change with it — nothing is canned |

Each item states the member, what they say, what should be looked up, the facts the
answer must include and the source each should cite, what must not be said, and the
expected outcome: answer, partial, clarify, no supported answer, refuse or route.
23 items are tagged with a known issue from the code review, so an expected failure is
already explained and unexplained failures are reported first. Four items wait on a
product decision. "No supported answer" is the correct result for what the documents
do not cover — deductible, premium, Extra Help, the coverage gap, review timelines,
approval criteria, shipping dates, today's preferred pharmacy, prices of drugs with no
price rule, pharmacy hours, anything outside pharmacy — and refusing well is scored.

**C. How the set is run**
- It drives the real call — session start, greeting, verification, then the caller's
  line goes in the normal way. It never calls the answer logic directly.
- Code checks facts and sources. A second model, different from the one answering,
  judges the judgement calls.
- **The judge is checked by a person.** The run writes a tick-box sheet. If the person
  disagrees with the judge on more than about one item in ten, the judged totals are
  not trusted. Why one in ten: the judge is a model too, so it needs its own error
  bar. Decisions will be made on differences of a few items per group; if the judge is
  wrong more often than that, its totals are noise. Facts checked by code are
  unaffected. One in ten is a deliberately cautious starting point for a small set —
  in production the same check is done against Humana's human QA and the bar is set
  from real agreement data.
- No silent skips: if the app or the judge is unavailable the run fails. A system error
  card is a failure, never a pass.
- Each item runs three times and is reported as a pass count, because results vary.
- The clock includes the fast model. Data-change items restore the records afterwards
  (verified by file hash). Expected results are never edited to make an item pass.

**D. Regression tests — run after changes throughout the build**
| Test | What it proves |
|---|---|
| Main call, end to end | The whole Harry call: greeting, refill, price question interrupted and returned to, offer, rebuttal, clear yes, pricing statement missed → caught → paraphrase → read late, prices, metformin-only enrollment by a person, coverage question, warm transfer, closing reread, notes, outcome |
| Refill-only call with small talk | Silence is correct: nothing shown for chit-chat, no offer, completed-servicing outcome |
| Caller raises the 90-day option | The closing statement applies because a choice was discussed — not because a button was clicked; no pricing statement needed |
| Firm refusal | The offer stops; no rebuttal after a clear no; closing still applies |
| Pharmacy changed mid-lookup | "Not Lakeview — Oak Street": the in-flight estimate is marked no longer valid, never relabelled |
| A record is missing | Charges shown, cause "not confirmed", no suggestion built on it — the proof answers depend on evidence |
| Scope changed, then withdrawn | Adding a medicine after confirmation cancels the confirmation; withdrawal blocks submit |
| Legal-wording checks | No stitching two attempts together; right speaker; unclear words neither pass nor fail; spelled-out amounts trigger; past charges do not; once per call; a finding cannot be overwritten |
| Authority checks | The AI cannot submit an enrollment; the permission token is one-time and tied to what was read back; "pending" is never shown as "connected"; a wrong returned scope is not shown as success |
| Access checks | No member data before verification; an instruction planted in a document changes nothing; the member is fixed by the session |
| Consent rules | Hedges, double questions and partial words never count as a clear yes; tested on phrasings from no script |
| Late results | A slow model result is never applied to a later question, a changed consent or a changed scope; legal triggers and member needs are never dropped |
| Sources and support | A true statement keeps its source; an invented amount is removed; a real source that lacks the fact is caught; money, dates and names compared in a standard form |
| Model failure | When the model fails the screen says so; no member facts appear as a stand-in answer |
| 10 multi-step questions, several members | Chained lookups work; this is the recorded basis for "no graph yet" |
| Not-canned checks | Same question, different members → different answers; same member, different questions; a new offer added as a document only; no script positions in code |
| Five-member suggestions | Right suggestion for Harry and for the other-plan member; none for the already-enrolled, the do-not-contact and the nothing-to-offer member, each for the right logged reason |
| Same suggestion, 10 runs | Run-to-run consistency of the next best action |
| Typed lines and End call | Unscripted questions, insulin copay (no dollar figure), "ignore your rules", clinical and coverage asks, a typed price triggering the pricing statement, End call mid-answer, unsaid closing recorded as missed, pending transfer never coded as transferred |
| Speed measurements | Each speed change measured alone: loaded member information, short answers, faster tier, early start, pre-loaded search; cold vs warm model calls; misses kept |

Cadence: every suite three times after each change while the logic was being built;
later a lighter rule matched to the size of the change; now screen-first, with suites
run on request. Failed run records were kept, never overwritten.

**E. By hand, on the screen**
A ten-part walkthrough: before Start, the main call beat by beat, each of the other
four members, typed caller questions by kind, typed advocate lines, attempts to break
consent and enrollment, End call in awkward places, odd inputs and a deliberate
network failure, the advocate's view vs behind the scenes, and how it feels. Five
questions are kept out of every file and typed live.

**F. What the testing taught**
Automated tests caught logic breaks — a lost interruption, an overwritten note, a
silent drop. They never caught what the screen showed: clutter, a missing suggestion,
half an answer. Hands-on walks caught those every time. Both are needed, and the
second cannot be delegated to the agent that wrote the code.

**G. In production:** the same structure, fed by de-identified real calls, with the
judge calibrated against Humana's human QA (roadmap phase 1). The same 109 items are
re-run for any candidate model, so models are compared on Humana-shaped work.

Results table for the 109-item set: add after the run.

## 10. Roadmap — validation first, then integration, then people (durations illustrative)
| Phase | What happens | Gate to move on |
|---|---|---|
| 0 Prototype (now) | One call family, made-up data | The experience and guardrails are coherent |
| 1 Baseline on recorded production calls (4–8 wks) | With privacy approval, run recorded calls through the checker. Build the judges: code for legal wording; a model judge for answer and suggestion quality, calibrated against Humana's human QA on a labelled sample. Measures how the CURRENT operation performs: miss rate per required statement by call type and tenure, after-call time, repeat questions. De-identified real calls become the evaluation set. No advocate sees anything. | Judge agrees with human QA to an agreed bar; a trusted baseline exists |
| 2 Integration foundations (8–12 wks, overlaps 1) | **Phone platform and live speech-to-text:** audio stream from the contact-center platform, speaker separation, call events (connect, hold, transfer, end), phone-menu and caller data. **Systems of record:** eligibility, benefits, claims, pharmacy, provider, scripting/knowledge — read-only first, with Humana identity, permissions and audit. **External:** CenterWell pharmacy and pricing, CRM, the QA platform, single sign-on, knowledge management. **Run it safely:** security and privacy review for protected health data, redaction, access control, tracing, logging, alerts, cost per call, latency per step (typical and worst case), a "copilot is down" mode. | End-to-end latency and cost budgets met on test calls; security and privacy sign-off |
| 3 Silent run on live calls (4–8 wks) | Full pipeline on real live calls, nothing shown to advocates. Measures live speech accuracy on the legal statements, real latency and cost, and what the copilot WOULD have said — scored by the judges. | Checker matches QA on live audio; false-alarm rate under the agreed bar |
| 4 Small launch with trusted senior advocates (6–8 wks) | 10–20 experienced advocates use it on real calls. They can tell when an answer or suggestion is wrong or does not apply, and say so with thumbs and reasons. Playbooks, rules and wording are corrected from their feedback. Notes are drafted but written back by hand. | Accuracy and applicability bars met; no safety incident; they want to keep it |
| 5 Bounded pilot with recently ramped advocates (8–12 wks) | The target user. One team, one call family, compared with a similar team without it. Legal statements and sourced answers live; suggestions only where senior advocates validated them. | Headline metric improves; handle time not worse; advocates use it |
| 6 Deeper help | More suggestions on; QA view graded from the same registry; notes and outcome written back to Humana's systems after the advocate confirms; ready answers chosen from real call data. | Suggestions used, not ignored; QA trusts the grading |
| 7 Wider | More call types, teams and channels. | Reuse holds; each area has governed content and owners |

Order logic: first learn how the current operation really performs, using calls that
already exist and a judge Humana's QA trusts. Build the plumbing while that runs.
Prove it silently on live calls. Put it in front of people who can catch its mistakes
before people who depend on it. Then the target user, then more help, then more places.
Note the deliberate sequence of users: senior advocates validate it; recently ramped
advocates are who it is for.

## 11. Current MVP and the end state
**MVP today (be exact on the day):** built — live call view, legal statements with
catch-and-correct and wording difference, sourced answers for any of five members,
playbook-driven suggestions with hard stops, human-only enrollment, warm transfer,
end-of-call notes and outcome, typed questions, End call, thumbs, labels in Humana's
words. In progress — screen redesign, "nothing needed" for non-questions, complete
$8/$27 answer, reliable suggestion for Harry, saved run logs. Not built — QA view,
evaluation run, real speech.
**End state:** embedded in every advocate's desktop for every regulated call type.
One registry of legal statements and one library of playbooks, owned by Legal and
operations, guide the call, grade it afterwards, train new hires, and feed other
channels. The AI does more of the after-call work on its own; regulated actions stay
with a person.
