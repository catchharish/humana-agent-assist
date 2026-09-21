# Humana Senior AI PM — presentation outline

**Agent Assist for Advocates. 45 minutes. 14 slides plus one live call.**

Built from `docs/FINAL_PRODUCT_DECISIONS.md`, `DECISIONS_LOG.md`, `PLAN.md`, `README.md`, `STATUS.md`, `SUBMISSION.md`, `runs/PHASE3_REPORT.md` and the assignment. Every number is cited to its section so you can check it. `docs/DECK_SYNTHESIS.md` was used only for framing; three of its numbers are wrong and are listed in the conflicts section at the end.

---

## The arithmetic

45 minutes. 20 to 25 on the deck, the rest on the call.

| Deck target | Seconds per slide, 14 slides | Demo left over |
|---|---|---|
| 20 minutes | 86 s | 25 minutes |
| **22.5 minutes** | **96 s** | **22.5 minutes** |
| 25 minutes | 107 s | 20 minutes |

Fourteen slides fits across that whole range, so the slide count does not need to move. The spoken tracks below run 40 to 90 seconds, which leaves roughly 10 to 25 seconds of slack per slide for the panel to interrupt. If they take more than that, slide 4 (journey) is the first to drop and slides 13 and 14 compress into one. Decide that before you walk in, not on the clock.

**Two decisions you made, recorded here so the deck matches them.**

1. **One main call, Harry Whitfield's.** The Open call is not in the demo, so the live "not canned" proof moves onto slide 7 as evidence and onto a spoken offer at the end of the demo. **Worth reopening now that the demo has roughly 20 minutes rather than 8:** an automated T01 runs in 52 to 68 seconds, so a narrated one with pauses is unlikely to fill that. Adding the Open call back as a two-minute closer would put the not-canned proof in front of their eyes instead of in your mouth. Your call. The slide below is written for the main call alone and takes one extra line if you want it back.
2. **Tradeoffs at slides 2 and 3.** Slide 2 is the cross-domain matrix you asked for (persona, screen, architecture, performance). Slide 3 is the single named tradeoff Humana asks each candidate for, since §29 settles that §26 D11 stays the one emphasized. Slide 1 opens on the founding decision with its rejected alternative, per your own anti-pattern rule. Say if you want 1 and 2 swapped.

---

## SLIDE 1 — Catch it on the call, not in a QA sample

**DIMENSION:** Problem & user insight. Also Judgment.
**SOURCE:** §5 D01 · §7 · §29 rows 2–3 · §2 · §10 outcome statement
**CLAIM:** The product cannot stop an advocate from speaking, so I built detection and correction on the call instead of claiming prevention.
**LAYOUT:** Two-column comparison with one callout.

**CONTENT:**

| Rejected: "prevent compliance errors" | Chosen: catch and correct on the call |
|---|---|
| Its proof would be a read-on-cue replay: the advocate reads the line when prompted | Exact wording on screen before the deadline |
| That shows nothing beyond putting text on a screen | A miss or paraphrase detected in seconds, with the word difference shown |
| The product guides. The advocate speaks | An exact reading on the same call. **The finding stays, marked "delivered correctly, but late"** |

Callout: The user is the **recently ramped advocate** who can own a call but has not memorized the exceptions. The design test for every screen decision: **does this help them talk to the member, or is it one more system to operate?**

**DENSITY:** 96 words.

**SAY:** I want to start with the decision that made this the product it is, because every other choice follows from it. The obvious headline for agent assist is prevention. Stop the compliance error before it happens. I did not build that, and I would not claim it. The way you would demo prevention is to have the advocate read the line when the screen prompts them, which proves nothing except that the screen can display text. The product guides. The advocate speaks. So the claim is narrower and it is testable. Put the exact wording up before the deadline. When the deadline is crossed anyway, detect it in seconds and show the advocate exactly which words were missing. Get it read correctly while the member is still on the line. And keep the finding on the record, marked delivered correctly but late, because a late reading is still a failure. You will see all of that happen in the call in a few minutes. The user throughout is the advocate who ramped six months ago, not the QA lead reviewing afterwards, because the miss happens on the call and that is where it has to be fixed.

**PROBE:** *"If you can't prevent the violation, what are we actually buying?"* Two things. The member hears the exact statement before the decision it relates to, and the miss is visible on this call rather than weeks later if the call happens to be sampled. Whether Legal and QA treat a late exact reading as materially better than none is a dependency I named in §28, not an assumption I buried.

---

## SLIDE 2 — Four tradeoffs, four domains

**DIMENSION:** Judgment. Also Thinking & accumulated judgment, and architecture and platform fit (§31.1).
**SOURCE:** §26 D11 · §14 D05 · §29 · PLAN 18 Sep reasoning-loop override · DECISIONS_LOG 18 Sep speed gate
**CLAIM:** Four decisions carry this build, each with an alternative I argued against and a cost I accepted.
**LAYOUT:** Matrix, four rows.

**CONTENT:**

| Domain | Chose | Instead of | Cost I accept |
|---|---|---|---|
| **User** | The recently ramped advocate, on the live call | QA and team leads, reviewing afterwards | Experienced advocates are not the design test, and must still be tested |
| **Screen** | One Now card. **Obligations loud, optional help quiet** *(the named tradeoff)* | Show every ready answer and every suggestion at once | Some correct help arrives late or is never offered |
| **Architecture** | **The model routes.** It sees the question and picks its own tools | A five-need routing table and pre-written answers | A slower first answer, recovered by measured levers |
| **Performance** | The compliance path runs on governed code, not a model call | One model path for everything | Two code paths to keep honest. The 1-second target is met only by the code one |

**DENSITY:** 104 words.

**SAY:** These four decisions carry the whole build, and I want them on one page because they are connected. Choosing the advocate over QA is what makes this a live-call product rather than a review tool. Choosing one dominant card over a busy dashboard is the tradeoff I will expand on next. Letting the model choose its own tools, rather than writing a table that maps five known questions to five known lookups, is what makes the demo survive a question I did not anticipate. And keeping the compliance path in code rather than in a model is a direct consequence of measuring latency before designing around it. Each of these cost me something real. The architecture choice made my flagship answer slower before I got it back. The screen choice means an advocate sometimes does not get help that was ready. I am not going to pretend those costs away. The rightmost column is the one I would want to interrogate if I were sitting where you are.

**PROBE:** *"Which of these would you reverse first if the pilot data went against you?"* The screen one. It has a defined revisit trigger: if advocates keep reopening deferred work or spend more effort correcting focus than they save, the focused view is wrong and I compare it against the broader view on equivalent tasks. The architecture one I would reverse only if chained lookups start failing on missing hops rather than on load, which is a different signal.

---

## SLIDE 3 — Obligations loud, optional help quiet

**DIMENSION:** Judgment (Humana's "one key tradeoff" deliverable).
**SOURCE:** §26 D11 · §14 attention and collision rules · §25 shadow-first sequencing · §10 beats 4–5
**CLAIM:** I protect advocate attention instead of maximizing how much useful guidance is visible at once, and the same choice repeats at three levels.
**LAYOUT:** Numbered path, three steps, with a callout.

**CONTENT:**

1. **On the screen.** While required wording is due, the Now card is **that exact wording and nothing else**. A finished metformin-cost answer waits on the open-needs list marked **Answer ready**, because today's refill is what the member is asking about.
2. **In the call.** The optional comparison waits for a natural point and an Offer click, and may never be offered. A firm no ends the branch. A member already on 90-day preferred mail gets a reasoned "nothing to offer," not a pitch.
3. **In the roadmap.** Wording verification goes live in Phase 1. Suggestions and rebuttals start in shadow.

Callout: The credible alternative was to show the current answer, every ready secondary answer and every useful suggestion together, and let the advocate pick. **The cost I accept is that some correct, useful help is delayed or never offered.** Compliance is never the thing made quiet.

**DENSITY:** 108 words.

**SAY:** Humana asks for one tradeoff, so this is it. The same judgment shows up three times, which is how I know it is a real tradeoff and not a slogan. On the screen, when a required legal statement is due, that statement owns the card by itself. Nothing else paints over it, including an answer the member is waiting for. In the call, the optional comparison is not pushed. It waits for a natural point, it needs me to click Offer, and on a member who is already getting ninety-day preferred mail the system reasons its way to nothing to offer rather than inventing a pitch. In the roadmap, the same order: the things bound to exact text go live, the judgment calls run in shadow. The alternative is genuinely defensible. Show everything, let the advocate choose, and you do not depend on the product picking the right focus. I rejected it because an advocate who gets interrupted by a badly timed tip stops looking at the panel, and then misses the statement too. The cost is real: some good help never arrives.

**PROBE:** *"How do you know you are not just hiding useful information?"* I do not, yet. It is a hypothesis with a named test. In Phase 1 I look at dismissal and ignore patterns and whether advocates repeatedly reopen deferred work. If they do, the focused view loses and I compare focused against broad on equivalent tasks, judged on disclosure outcomes and net effort, not on which screen looks better.

---

## SLIDE 4 — The call today, and the call with this

**DIMENSION:** Journey mapping.
**SOURCE:** §8 · §9 D02 · §14 regions
**CLAIM:** The future journey changes what the advocate has to hold in their head, and leaves every decision with them.
**LAYOUT:** Table, five stages.

**CONTENT:**

| Stage | Today | With the copilot | The human still does |
|---|---|---|---|
| Open | Opening wording competes with listening | Exact greeting from the registry. The phone-menu hint prepares work but **is not identity** | Speaks the greeting |
| Respond | Join records to policy across tabs | Call type and current step read from evidence. A sourced answer, or due-now wording, on one card | Speaks, and inspects sources |
| Adapt | A new question buries the old one | Needs survive a focus change. A changed pharmacy **invalidates** the affected quote | Chooses the focus |
| Recover | Guess, or reread from memory | Uncertain speech stays uncertain. A clear reread is offered | Rereads |
| After | Notes rebuilt from memory, code guessed | Wrap drafted from what actually happened, each line sourced. Disposition recommended with cited reasons | Confirms the code |

Callout: A ready answer is not a resolved need. A declined offer is a valid outcome. Changing topic does not cancel a due disclosure.

**DENSITY:** 106 words.

**SAY:** This is the before and after, and the column on the right is the one I care about. Every row still ends with the advocate doing the thing that matters. Three specifics worth pulling out. At the open, the phone menu says refill, and the product uses that to prepare the workflow and the greeting, but it will not show you a single member field until simulated identity comes back valid. Routing is a hint, not identity. In the adapt row, if the member corrects the pharmacy mid-lookup, the old result does not get relabelled with the new pharmacy's name. It gets invalidated and the correct one is fetched. That is a test in the suite, not a claim. And at the end, the wrap is drafted from evidence, each line naming one source, and the disposition code is recommended with reasons, never filed automatically. The three lines at the bottom are the ones I would put on a wall. A ready answer is not a resolved need. A declined offer is success. Changing topic does not cancel a disclosure you owe.

**PROBE:** *"What does this remove from the advocate's job, concretely?"* Holding unfinished work in memory across interruptions, hunting the same facts across six systems, and reconstructing the call afterwards. It does not remove judgment, speaking, or any regulated decision, and I would not want it to.

---

## SLIDE 5 — Where the AI acts, and where it has no route

**DIMENSION:** Responsible AI.
**SOURCE:** §11 brief matrix · §15 D13-F · README enrollment boundary · PLAN NBA hard stops
**CLAIM:** The human-only boundary is enforced by a token and by code stops, not by hiding a button.
**LAYOUT:** Three-column table with a callout.

**CONTENT:**

| AI on its own | AI recommends, advocate decides | Human only, no AI route exists |
|---|---|---|
| Surface the next step; check wording against the registry; detect a miss or paraphrase; draft the wrap and handoff | Objection reply; next best action; transfer destination; disposition code | Submit the enrollment; make a coverage determination; take payment; give clinical advice |

Callout: **The boundary is a token, not a hidden button.** Human Confirm mints a one-time server token bound to the read-back scope. The pharmacy enrollment POST returns **403** without an unused matching token, and the AI tool registry has no mint, read or submit. Coverage determination, payment and clinical advice are **not tools at all**.

Second callout: Seven hard stops run in code before any suggestion is drawn: unverified identity, due-now wording, already enrolled, said no this call, do not contact, dismissed this call, unconfirmed fact.

**DENSITY:** 102 words.

**SAY:** This is Humana's own matrix, and I kept it exactly as given. What I want to show you is how the right-hand column is actually enforced, because the weak version of this is to hide a button and tell the model to be careful. When I confirm an enrollment as the advocate, the server mints a one-time token bound to the exact scope I read back to the member. The pharmacy endpoint rejects the write with a 403 if that token is missing, already used, or the scope differs. The AI's tool list has no way to mint one, read one, or submit. Coverage determination, payment and clinical advice are not in the tool list at all, so there is nothing to refuse. Separately, before any suggestion card is drawn, seven conditions stop it in code. Identity not verified. Legal wording due. Already enrolled. Said no. Do not contact. Dismissed this call. Or the suggestion leans on a fact the support check did not confirm. Those are code, not prompt instructions.

**PROBE:** *"What stops the model from just writing a plausible enrollment confirmation into the wrap?"* The support check. Every statement in the wrap names one source id, and code re-reads that record and compares the values. An enrollment result the model asserts without a returned record is dropped. Separately, code blocks the disposition code "enrolled" without a confirmed enrollment result and "transferred" without a confirmed connection.

---

## SLIDE 6 — The nudge is code, and the model never judges wording

**DIMENSION:** AI that does real work. Also Responsible AI.
**SOURCE:** §15 D13-E · PLAN item 7 two-stage trigger · §12.4 · DECISIONS_LOG 18 Sep governed utterance rules
**CLAIM:** Whether a required statement is owed, and whether it was said exactly, are decided by governed rules and a string match, never by a model.
**LAYOUT:** Numbered path with a callout.

**CONTENT:**

1. **Stage 1, code, no model call.** Fires only when all three hold: the line contains an amount, **and** a future-estimate cue from the registry's trigger patterns, **and** the current need is a prospective comparison. Runs in **14 to 26 ms**.
2. **Stage 2, small model, ambiguous partials only.** An amount with no cue. Comparative language with no figure.
3. **Exactness is a string match** against registry text. Punctuation and capitalization ignored. Omitted or replaced words are not.

Callout: **"Prices can vary by pharmacy" names no option and no amount, so it does not fire the pricing requirement. "About six dollars cheaper at CenterWell" does.** Harry's $8 and $27 are completed charges, so the estimate rule is not due there. Stage 1 must never fire on historical speech, because **a fired nudge must never need retracting**.

**DENSITY:** 99 words.

**SAY:** Here is the part I would push back hardest on if someone showed me this deck. The most tempting thing to do with a language model is ask it whether the advocate said the required statement. I do not do that anywhere. The trigger for whether a statement is owed runs in two stages. Stage one is plain code reading the registry's own trigger patterns, and it fires only when three conditions hold at once: there is an amount in what I said, there is a future-estimate cue, and the live need is a prospective comparison. That path takes fourteen to twenty-six milliseconds. Stage two is a small model, and it only sees the genuinely ambiguous cases. Then exactness is a string comparison against the registry text. Punctuation and capitalization are ignored. A missing word is not. The line at the bottom is the one that shows the rule is real. A generic remark that prices vary names no option and no amount, so it does not fire. Naming CenterWell and six dollars does. And Harry's eight and twenty-seven dollars are charges he already paid, so the estimate rule is not owed there at all.

**PROBE:** *"Why does it matter that stage one never fires on historical charges?"* Because a compliance nudge that appears and then withdraws destroys the advocate's trust in every nudge after it. The rule in the build is that a fired nudge must never need retracting, so anything that could be historical goes to stage two before it can paint.

---

## SLIDE 7 — The model routes, and nothing here is canned

**DIMENSION:** AI that does real work. Also architecture and platform fit (§31.1).
**SOURCE:** PLAN 18 Sep reasoning-loop override · §17 · DECISIONS_LOG 19 Sep chain eval · `tests/not_canned.test.ts`
**CLAIM:** The model chooses its own lookups for any member and any question, and the proof is that the same question gives different answers on different records.
**LAYOUT:** Bullets with an evidence row and a callout.

**CONTENT:**

- The model sees the question, the session-bound member and the conversation, then picks its tools: a generated ready answer, member record APIs, document search, or a chain. **There is no routing table in code.**
- **The session binds the member.** Tools do not take a model-supplied member id, so a cross-member request cannot succeed.
- Quotes are locked until comparison consent is a clear yes. "Why was it $27?" asked before consent mentions no future price.
- Offers live in playbook documents carrying `Action id:` and `Advocate control:`. **A new offer is a new document, not a code change.**

Evidence row: **10 multi-step questions across 5 members: 10/10 correct, 0 over 8 seconds** · same question, different member, different facts · a playbook-only offer appears for a member with no code path naming it.

**DENSITY:** 107 words.

**SAY:** This is the slide that decides whether you believe the demo. The easy version of this take-home is five questions with five prepared answers and a router that recognizes which one you asked. I built that first by accident, and I will tell you how in a second. What runs now is that the model sees your question, sees the member the session is bound to, and chooses its own lookups. There is no code that says if the need is historical price then fetch these three things. The member is bound server-side, so the model cannot ask about someone else even if retrieved text tells it to. Prices for future fills are locked until the member says a clear yes to hearing them. And the offers are documents, not code, so a new offer is a new document that Legal or ops can own. The evidence is at the bottom. Ten multi-step questions across five members, all correct, none over eight seconds, and a suggestion that appears for one member purely because a playbook document exists for it, with no code that names it.

**Callout, what building this taught me:** Left alone, the coding agent fitted the build to the script: hardcoded amounts, scripted sentences dressed up as rules, a router that knew five questions, and a fake answer when the model failed. The fix was process, not prompting. General fixes only. Test questions the agent never sees. Behaviour-based tests instead of output matching. And my own click-through, which caught things the tests did not.

**PROBE:** *"Prove it is not canned, right now."* Pick any of the other four members and ask anything you like. The same loop runs and the answers change with the records. I have a five-member run on file where the same pickup question returns a different answer and a different disposition for each one, including two that honestly return no supported record.

---

## SLIDE 8 — A citation is not authority

**DIMENSION:** Responsible AI. Also AI that does real work, and architecture and platform fit.
**SOURCE:** §17 · §27 interface.ai · §19.3 T06A · DECISIONS_LOG 19–20 Sep support check
**CLAIM:** Every generated statement names one source, and code re-reads that source to confirm it actually contains the fact.
**LAYOUT:** Numbered path with a callout.

**CONTENT:**

1. Every generated statement names **exactly one source id** before it is checked.
2. Code re-reads the cited record and compares money, dates and names in a standard form. Unsupported sentences are removed or marked not confirmed. Cost: **0.1 to 3 ms** per statement.
3. Applicability is checked against the **session's plan**, not a keyword match. A policy for another plan is **rejected as wrong-plan for Harry and kept for the member it applies to**, and the diagnostic says which.
4. Remove one classification record and the same question gets a different answer: the two charges stand, the cause does not, and the screen says **"The cause is not confirmed."**

Callout, experience that shaped this: At **interface.ai**, the inherited employee assistant could retrieve internal policy and a public promotional page with different APRs, side by side. Relevance is not applicability, and a citation is not proof. **I owned the trust diagnosis, product direction and requirements, the governance and evaluation approach, and the acceptance cases. Engineering owned the implementation, and I did not build that assistant from scratch.**

**DENSITY:** 110 words.

**SAY:** The failure mode I care most about is the fluent answer with a real citation attached to a claim the source does not support. So the pipeline is built around that. Each statement the model writes carries exactly one source id. Then code goes back to the record it cited and checks that the amounts, the dates and the names are actually in it. Sentences that fail come out, or get marked not confirmed. That check costs between a tenth of a millisecond and three milliseconds, so there is no excuse for skipping it. Applicability is separate from retrieval: the same policy document is correct for one member and wrong for Harry, and the system rejects it on plan, not on a keyword. The fourth line is the test I would run in front of you. Take away one classification record and ask the identical question. The two charges are still established, the explanation for why they differ is not, and the screen says so rather than inventing a plausible cause. That lesson is not from this project. It is from watching an inherited assistant cite a marketing page next to a policy.

**PROBE:** *"What did you personally own on that interface.ai work?"* The trust diagnosis, the product direction and requirements, the governance and evaluation approach, and the acceptance cases. Engineering owned the implementation. I inherited that assistant, I did not build it, and I am not claiming production trust metrics or adoption numbers from it.

---

## SLIDE 9 — Latency is a product decision

**DIMENSION:** Execution. Also architecture and platform fit.
**SOURCE:** §22.1 targets · DECISIONS_LOG 17–18 Sep measurements · SUBMISSION constraints · `runs/PHASE3_REPORT.md`
**CLAIM:** Because a hosted model round trip has a floor of roughly 0.7 seconds, the compliance path cannot depend on one, and the measurements say which path is which.
**LAYOUT:** Metric table, four rows.

**CONTENT:**

| Path | What it measures | Measured | Against target |
|---|---|---|---|
| Governed rules, code | Stage-1 trigger, exactness | **14–26 ms** | 1s, met |
| Disclosure trigger, small model, priority tier, hedged | Ambiguous partials only | **median 878 ms, max 1,176 ms, 2 of 20 over 1s** | 1s, mostly met, misses logged |
| Per-utterance interpretation, accepted run | Full conversation reading | **23 of 23 finals over 1s. Median 1,327 ms, max 3,967 ms** | 1s, **missed, and recorded as missed** |
| Answer loop, 10-question chain | Multi-step member answers | **10/10 correct, 0 over 8s.** A later run had one question at **9,647 ms** | 8s, one real miss |

Callout: **Targets did not move to make results pass.** Measured levers took the flagship answer from a 6,549 ms median to **1,778 ms**: load the member snapshot once, keep answers short, and use the faster service tier.

**DENSITY:** 104 words.

**SAY:** I want to be precise here, because latency numbers are the easiest thing in a deck to quote out of context. There are four different paths and they measure four different things. The governed rules that decide whether a legal statement is owed and whether it was said exactly are code, and they run in fourteen to twenty-six milliseconds. The small model that handles genuinely ambiguous trigger cases runs at a median of 878 milliseconds with two of twenty over a second, and I pay double list price for that tier to get it. The full conversation interpretation is the slow one, and on my accepted run every one of twenty-three final utterances was over a second, median 1.3, worst case just under four. I record that as a miss, because it is one. And the answer loop completed ten multi-step questions with none over eight seconds, although a later run under load had one at 9.6 seconds, which is also a miss. The reason the compliance path is code is exactly this: the floor on a hosted model call is about seven tenths of a second, so a one-second compliance target cannot depend on one.

**PROBE:** *"So the one-second target is not actually met?"* It is met on the path that has to meet it, which is the trigger and the exactness check, and it is not met on per-utterance interpretation, which I report as a miss rather than relabelling. If I were taking this to production the next move is a small classifier hosted next to the call stream rather than a hosted API call.

---

## SLIDE 10 — The deferred answer is the tradeoff, on screen

**DIMENSION:** Execution. Also Judgment.
**SOURCE:** §10 beats 4–5 · §14 attention rules · §15 D13-B · §27 GoHealth · DECISIONS_LOG 20 Sep park and resume
**CLAIM:** An interruption defers work instead of losing it, and the return re-fetches the question rather than replaying an old answer.
**LAYOUT:** Numbered path, five steps, with a callout.

**CONTENT:**

1. Harry asks why metformin was **$8 last month and $27 yesterday**.
2. Before the answer lands he interrupts: is my refill ready today? **The refill becomes primary.**
3. The metformin answer arrives late. **It does not take the screen.** It parks on the open need marked **Answer ready**, and the need stays unresolved.
4. Harry says "So, the metformin?" The parked question is **re-fetched**, its dependencies rechecked, and the answer paints.
5. The explanation names the cause from records: the same 30-day supply, **Oak Street preferred retail on 18 Aug, Lakeview standard retail on 16 Sep**, and the plan rule giving $8 and $27.

Callout, experience that shaped this: At **GoHealth**, newer agents moved across fragmented plan, drug, provider, pharmacy and member sources while experienced agents had internalized a decision process. Disagreements usually traced to **missing context or inconsistent data, not a weak model**. So this joins facts to the current step and keeps unfinished work alive, rather than adding a knowledge chatbot and leaving coordination to the advocate.

**DENSITY:** 108 words.

**SAY:** This is the slide that sets up the part of the demo I will not cut. Harry asks why his metformin cost eight dollars one month and twenty-seven the next. Before that answer comes back he interrupts himself and asks whether today's refill is ready. The refill becomes the primary thing on screen, because that is what he is waiting on. Then the metformin answer arrives, and it does not take over. It parks, marked Answer ready, and the need stays open and unresolved, because a ready answer is not a resolved need. When he comes back to it, the system re-fetches the question and rechecks its dependencies rather than replaying whatever it had. And the answer names an actual cause from records: same thirty-day supply both times, Oak Street was preferred retail on the eighteenth of August, Lakeview was standard retail on the sixteenth of September, and the plan rule gives eight and twenty-seven for those categories. That last part comes straight from GoHealth. The disagreements I watched there were almost never the model being stupid. They were missing context and mismatched inputs.

**PROBE:** *"Why re-fetch instead of using the answer you already had?"* Because facts can change while the answer is parked. A pharmacy correction, a fresh status, a source that got invalidated. Promoting a stale answer because it happens to be ready is exactly the failure the contract calls invalidated guidance presented as current.

---

## SLIDE 11 — Live demo: Harry Whitfield's call

**DIMENSION:** Execution, carrying AI that does real work.
**SOURCE:** §10 beats · §15 D13-B, D13-C, D13-E, D13-F, D13-G · §19.2 T01
**CLAIM:** One call, showing the four things the brief asks for plus the tradeoff from slide 3.
**LAYOUT:** Numbered run order. Project the beat names only; the narration lines are speaker notes.

**CONTENT — run order, with the line you narrate as each beat happens:**

1. **Greeting and identity.** *"Nothing about Harry is on screen yet. The phone menu said refill. That is a hint, not identity."*
2. **The refill question.** *"He has an existing request at Lakeview. The record says the request exists. It does not say it is ready."*
3. **The price question.** *"Eight dollars last month, twenty-seven yesterday. Watch where this goes."*
4. **The interrupt.** *"Refill takes over. Watch the metformin answer park as Answer ready. That is the tradeoff, on screen."*
5. **The return.** *"He comes back to it. The question is re-fetched, not replayed. Same supply, two pharmacies, two cost-share categories on those dates."*
6. **The optional comparison is offered.** *"The system recommends offering it. It does not offer it, and it cannot enroll anyone."*
7. **"How does the 90-day option work?"** *"This answer is derived from the service document and carries lineage back to it. It will not invent a delivery date and it will not tell him what dose to take."*
8. **Hesitation.** *"He would rather talk to his pharmacist. That is a decision-relevant preference, not an objection to overcome. The reply keeps retail on the table and leaves today's pickup alone."*
9. **Comparison interest, hedge, clarification, absolute yes.** *"Hearing prices enrolls him in nothing. A hedge is not a yes, so it asks once, neutrally."*
10. **The pricing miss.** *"I quoted fifteen dollars before reading the statement. The deadline is crossed. It shows what I said, what is missing, what I added. I read it exactly, and it stays delivered correctly, but late."*
11. **The six estimates.** *"Oak Street and CenterWell are equal on atorvastatin at six dollars. On metformin, CenterWell is six dollars below preferred retail, not forty-two below everything."*
12. **Metformin only.** *"Both were compared. Only metformin goes in the draft. I read back the scope, he confirms, I submit. The AI has no route to this."*
13. **Jardiance.** *"Pending is not denied, and connecting him is not resolving it."*
14. **Closing reread, transfer connected, wrap and disposition.** *"The wrap is drafted from what happened, each line naming one source. The code is recommended. I confirm it."*

**The five beats that carry the argument, if you have to compress on the day:** 4 and 5 (the deferred answer, which is the tradeoff from slide 3) · 9 (the absolute yes) · 10 (the nudge) · 12 (the scoped enrollment) · 14 (handoff, closing and wrap). Beats 7 and 8 and the spoken walk of all six estimates are the ones to shorten first: show the comparison table and speak only the two metformin figures.

**Closing offer, since the Open call is not in the run:** *"Pick any of the other four members and ask them anything you like. The same loop runs, and the answers change with the records."*

**DENSITY:** the fourteen beat names are the slide. Keep the narration in the speaker notes.

**SAY:** *(the fourteen narration lines above are the spoken track; do not read this section aloud)*

**PROBE:** *"Is this scripted?"* The conversation is a timed synthetic stream, yes, because I have no real telephony. What is not scripted is everything the product does with it. The classifications, the lookups, the answers, the nudge, the wrap and the disposition are all produced live from the inputs, and the test driver is blocked from injecting any of them. If you want, switch the member and ask something I have not prepared.

---

## SLIDE 12 — Rejected alternatives, and deliberate non-builds

**DIMENSION:** Judgment. Also Thinking & accumulated judgment.
**SOURCE:** §29 rejected alternatives · SUBMISSION "deliberately not built" · README known limitations · §12.3 Tier 3
**CLAIM:** Two different questions. Paths I argued against, and capabilities I chose not to build in the time I had.
**LAYOUT:** Two-column comparison.

**CONTENT:**

| **Rejected alternatives** — argued against, would not build them now | **Deliberate non-builds** — correct to build later. The screen shows a limitation, never a fake success |
|---|---|
| A conversion-led funnel, and a universal refill-to-enrollment flow | Quick ask |
| Answers keyed to the beat number | Closing attestation |
| A cheapest-pharmacy claim that omits a matched retail option | Failed-read retry |
| Attestation treated as verified speech | Enrollment status check after an unknown write |
| An always-on feed, and approval of every update | Outage mode |
| A generic Retry button on legal text | The post-call QA stretch |
| A broader pricing trigger only because it is broader | The remaining test catalog |

**DENSITY:** 78 words.

**SAY:** These are two different questions and I want to keep them apart. On the left are paths I considered and argued against, and I would still argue against them. The funnel one matters most: the brief's example flow ends in enrollment, but building a product that pushes every refill call toward enrollment would be the wrong reading of it, so an informed decline is a valid outcome throughout. Beat-keyed answers would have made a much smoother demo and proved nothing. And a generic retry button on legal text is the kind of convenience that quietly turns into an advocate re-reading something they should not be editing. On the right are things I think are correct and simply did not build in two to three days. The important property is what happens when one of those conditions occurs in the prototype: the screen shows the limitation honestly. It does not fake a success. If the model fails to answer, it says it could not answer, logs the cause, and offers a retry of that answer. It does not fall back to a canned sentence.

**PROBE:** *"Which non-build would you do first?"* The unknown-write status check, because it is the only one on that list where the failure mode is a duplicate business action. Everything else on the right degrades into an honest limitation. That one, done wrong, enrolls someone twice.

---

## SLIDE 13 — Assumptions, and what would break each

**DIMENSION:** Thinking & accumulated judgment.
**SOURCE:** §28 assumptions · §24.1 Legal dependency · §30 validation plan
**CLAIM:** Four categories of assumption, each with the observation that would invalidate it.
**LAYOUT:** Table, four rows.

**CONTENT:**

| Category | What I assumed | What would invalidate it |
|---|---|---|
| **Members** | Harry interrupts, prefers retail, picks one medicine. Authored case inputs, **not a mix rate** | Observing a real call family shows a different mix. Harry stops being the design case |
| **Advocates** | A few wrong suggestions early cost trust faster than later accuracy wins it back | Phase 1 dismissal patterns and interviews. If it does not hold, **show approved suggestions sooner** |
| **Data and operations** | Humana's desktop can host an embedded view that opens on call connect | The platform allows only a compact dock. The five regions become a smaller layout |
| **Constraints** | A late exact reading is materially better than none | **Legal and QA decide.** If late and absent are treated the same, the lead measure reverts to total failures and the value narrows to detection speed |

Callout: 1, 2, 5 and 8 seconds are prototype targets, not service levels. **No baseline, miss rate, savings percentage or budget is supplied anywhere in this work.**

**DENSITY:** 103 words.

**SAY:** The brief asks for assumptions in four categories, so here they are with the thing that would break each one, because an assumption without a disconfirming test is just an opinion. On members: Harry is an authored case, not a claim about how often people interrupt or prefer retail. If real call data shows a different shape, he stops being the design case. On advocates: my whole shadow-first roadmap rests on a hypothesis, that a handful of wrong suggestions early costs trust faster than later accuracy wins it back. If Phase 1 says otherwise I show approved suggestions sooner. On data: I assumed your advocate desktop can host an embedded view that opens on connect. I have not verified that, and if it turns out you only have a compact dock, my five regions become a smaller layout. And the one that matters most for the business case: I assumed a late exact reading is better than none. That is Legal and QA's call, not mine. If they treat late and absent identically, my lead metric changes and the value claim narrows.

**PROBE:** *"Which assumption worries you most?"* The desktop one, because it is the only one that changes the design rather than the measurement. If the answer is a narrow dock, the five-region layout does not survive and I would rather find that out in week one than after building for it.

---

## SLIDE 14 — Roadmap, and what I would do differently

**DIMENSION:** Judgment. Also Thinking & accumulated judgment.
**SOURCE:** §25 D10 · §30 what we would do differently · SUBMISSION roadmap gates
**CLAIM:** Put in front of advocates first what is bound to exact text and records, hold the judgment calls in shadow, and gate each phase on evidence rather than on a date.
**LAYOUT:** Table, four phases.

**CONTENT:**

| Phase | What goes live | Why here | Gate |
|---|---|---|---|
| **0 Prototype** | One call, five members, six contrasts | The only place to show every behaviour with no member risk | Observed runs and known limits. Not business impact |
| **1 Bounded pilot** | Wording verification, sourced answers, wrap and handoff. **Suggestions and rebuttals run in shadow** | Exact text and records are checkable. Judgment calls need approved content and a measured false-suggestion rate first | Independent review of unrecovered against recovered-late failures, false alerts, latency, net support work |
| **2 Deeper, same shop** | Visible approved suggestions, matched comparisons, evidence-based QA | Needs Phase 1 shadow evidence and approved content | Incremental compliance and service against workload |
| **3 More families, channels** | Reuse the governed knowledge and instrumentation | Reuse is worth having once the pattern holds in one operation | Local quality and maintenance cost. Copying the UI is not a channel launch |

Callout: **The first pilot family cannot be status calls.** Under these rules a status-only pilot barely exercises the pricing and closing requirements, so the candidate is pharmacy cost and 90-day service calls, where real estimates and real service discussions happen.

Second callout, what I would do differently: **Lock the business outcome and the first call family before expanding the contract.** Build the slice early enough to hit the timing and interaction problems. Grow tests from actual failures rather than making the whole catalog mandatory up front.

**DENSITY:** 110 words.

**SAY:** The sequencing principle is one sentence: put in front of advocates first the things that are bound to exact text and records, because their errors are checkable and their value does not wait on content approval. Wording verification and sourced answers go live in Phase 1. The suggestions and the objection replies run in shadow, logged with their evidence and their timing, visible to nobody on the call. Phase 2 makes them visible only where the shadow data supports it and the content has been approved. Phase 3 is reuse, and reuse is worth having only after the pattern holds in one operation. The callout is the thing I would want a product leader to push on. It would be much easier to pilot on status calls, and it would be close to useless, because under these disclosure rules a status call barely triggers the pricing or closing requirements at all. You have to pilot where the compliance events actually happen. And if I did this again, I would lock the business outcome and the first call family before writing a line of the contract.

**PROBE:** *"Why shadow rather than just launching the suggestions?"* Because a hidden recommendation tells me the false-suggestion and missed-opportunity rate without spending advocate trust to find it out. What shadow cannot tell me is whether advocates accept or act on them, so it is a sequencing choice, not a substitute for the visible pilot. It is also not zero risk: it still processes real data and still needs governance.

---

# Coverage table

| Rubric dimension | Slides that score it | Weight of coverage |
|---|---|---|
| **Problem & user insight** | 1 (primary), 4 | Opening decision plus the persona and design test on 1; the current journey on 4 |
| **AI that does real work** | 6, 7, 8, 11 | The nudge mechanism, the routing, the support check, and the live call |
| **Journey mapping** | 4, 10, 11, 14 | Current to future on 4; the in-call mechanism on 10 and 11; the path to production on 14 |
| **Execution** | 9, 10, 11 | Measured latency, the deferred-answer mechanism, the demo |
| **Judgment** | 2, 3, 12, 14 | The tradeoff matrix, the named tradeoff, rejected paths against non-builds, the roadmap order |
| **Responsible AI** | 5, 6, 8 | Token-enforced boundary and seven hard stops, wording never model-judged, citations verified |
| **Thinking & accumulated judgment** | 2, 3, 7, 8, 10, 12, 13, 14 | **Eight slides.** Past experience is placed on 8 (interface.ai) and 10 (GoHealth), with the build lesson on 7. Assumptions get a full slide at 13 |
| **Architecture & platform fit (§31.1, not in the brief's table)** | 2, 7, 8, 9 | Content separated from workflow, the model routes, lineage and applicability, latency as a design constraint |

**"Show your thinking," the four named items, and where each gets real estate:**

| Item | Where | Real estate |
|---|---|---|
| Decisions: considered, chosen, and deliberately not built | **Slides 1, 2, 12** | Slide 2 carries "instead of" for four domains. Slide 12 separates rejected alternatives from non-builds in two columns |
| Assumptions: members, advocates, data, constraints, each with what would invalidate it | **Slide 13** | Full slide, four categories, paired invalidators |
| How past experience shaped this | **Slides 8 and 10** | Placed on the slide the lesson shaped, not collected at the end. interface.ai on the citation check, GoHealth on joining facts to the current step |
| What I would do next, and differently | **Slides 12 and 14** | Non-builds with their order on 12; the retrospective callout on 14 |

---

# Conflicts across the files. Flagged, not resolved.

### 1. Latency. Four measurements of four different paths.

| Source | Number | What it actually measures |
|---|---|---|
| `DECK_SYNTHESIS.md` §6 | "warm median 0.9 s, 4 of 10 over one second" | A **bare keep-alive ping** to `/v1/responses` on 17 Sep, 16 output tokens, warm-up of 1,563 ms discarded. Ten sequential calls, median 899 ms, max 1,431 ms. This is the model responding to a trivial payload. It is not any product path |
| `SUBMISSION.md`, constraints | "Accepted run `00d1a1b6`: 23 of 23 finals over 1s, median 1,327 ms, max 3,967 ms" | **Full per-utterance interpretation** on the accepted T01 run. Reading call type, needs, focus and consent from real utterances. `SUBMISSION.md` explicitly forbids citing the 899 ms figure as the accepted-run number |
| `DECISIONS_LOG.md`, 18 Sep priority tier | "20 warm C01 + hedge: median 878 ms, max 1,176 ms, 2 of 20 over 1 s" | **Disclosure trigger classification only**, on the priority service tier, hedged (two identical requests, first complete wins), at 2× Luna list price. Enum output, not interpretation |
| `DECISIONS_LOG.md`, 18 Sep governed rules | "14–26 ms" | **Stage-1 code**, a conservative regex on the transcript line. No model call |

**Which belongs on the latency slide.** All four, as four rows, which is what slide 9 does. The 899 ms figure must never appear alone as "our warm median," because `SUBMISSION.md` forbids exactly that and because it measures a ping, not the product. The number that answers "does the compliance path meet one second" is **14–26 ms for stage one and a median of 878 ms for the trigger model**. The number that answers "does the product read every utterance within a second" is **23 of 23 over one second**, and it is a miss. Do not blend them.

### 2. The chain evaluation. Two different runs, not one.

- **19 Sep**, `runs/chain_eval_1789835175024.json`: 10 questions across five members, **10/10 correct, 0 over 8 s, 0 errors**. This is the run that produced the recorded "do not build a graph" recommendation in `DECISIONS_LOG.md` and `PLAN.md`.
- **20 Sep**, Phase 3 combined pack, three runs: all three **10/10 correct**. Run 1 had **c02 at 9,647 ms**, the only question over eight seconds across all thirty answers. Runs 2 and 3 had c02 at 4,314 ms and 4,518 ms.

**They are not the same run.** `PLAN.md` states the position explicitly: "the later 8 s miss is load, not a missing hop. Do not treat it as a reopen." Both are honest to state. If you cite 10/10 with none over eight seconds, say it is the 19 Sep run, and volunteer that a later run under load had one question at 9.6 seconds.

### 3. Retry. Five distinct things carry that name.

| What | Status | Where |
|---|---|---|
| **Failed-read retry** ("Check again" on a failed lookup) | **Not built.** Tier 3 | §12.3 · README known limitations |
| **Generic retry on legal text** | **Rejected**, deliberately | §29 |
| **One HTTP retry on 429 or 5xx**, inside the 8-second clock, 250 ms wait | **Built.** `lib/answerLoop.ts` | DECISIONS_LOG 20 Sep, "Honest miss" |
| **Retry this answer**, a human control after an honest miss | **Built.** `POST /api/session/human/retry-answer` re-runs the question loop | `lib/copilot.ts` `retryLastAnswer` |
| **Up to 3 disposition repair attempts** against the model when its cited reasons fail the support check | **Built.** Gates do not relax; a rejected attempt is told why | `runs/PHASE3_REPORT.md` §3 |

`DECK_SYNTHESIS.md` describes "a retry" without saying which. On a slide, say which one. The honest sentence is: **the model-call retry and the advocate's retry-this-answer control are built; retrying a failed data read is not, and a generic retry on legal text was rejected.**

### 4. Feedback capture. In the running build, and narrower than the synthesis implies.

`DECK_SYNTHESIS.md` calls it "one pair of thumbs plus reasons on every AI output" and lists it as "how the product improves after launch." What is actually in the build:

- Thumbs up and down on cards. Thumbs down opens a pop-over with six fixed reasons (**Wrong fact, Not relevant, Bad timing, Too long, Unclear, Other**) plus a free-text note.
- `POST /api/session/human/thumb` writes an `advocate_thumb` row to the session JSONL with the card, its kind, its cited sources, the reason and the note.
- Thumbs on tips and replies call the existing Offer, Dismiss or Use routes. **A thumb on an answer also promotes a waiting recommendation to the Now card**, alongside the 5-second and caller-moves-on triggers.
- **It logs. It does not learn.** Nothing tunes a playbook, a threshold or a model from a thumb. §22.4 is explicit that a dismissal may mean "not now" and a thumbs-up is not a gold label.

Claim it as **built and instrumented**, and as **a Phase 2 input that is reviewed, not a live learning loop**. Do not say it tunes the playbooks. It does not.

---

# Demo beats at risk right now, from `STATUS.md`

**At risk: the AI-generated optional comparison offer, which is beat 6 and its payoff at beat 11.** On the last recorded live walk the price next-best-action returned `none`, because all three of the model's fact rows were the same $8 fill rather than both paid claims. Record-fact inputs were added after that walk so both claims can sit under `confirmedThisCall`. **The call has not been re-walked since.**

**Neither beat 6 nor beat 11 is on the §10 never-cut list.** That list is beats 4–5, 9, 10, 12 and 13–15.

**But three never-cut beats sit downstream of that branch.** Beat 9 (the absolute yes), beat 10 (the pricing miss and nudge) and beat 12 (the metformin-only enrollment) all assume the comparison conversation started. They do not require the AI card: you can open the branch yourself with the presenter speech control, and beat 10's nudge fires from stage-1 registry patterns on your own utterance whether or not a suggestion ever painted. So **the never-cut beats are recoverable by hand.** What you lose is the live proof that the AI initiated the offer, on the dimension the brief calls "AI that does real work."

**Two more, smaller.** Laptop width has not been checked against `Design.pdf`. And `SUBMISSION.md` states that C06 must be re-ticked on the presentation machine, and that an automated T01 pass is not a C06 pass.

**One re-walk of the main call settles the first risk.** That is already `STATUS.md`'s own next task.

---

# Open questions

1. **Does the 45 minutes include panel Q&A, or is Q&A on top of it?** The arithmetic assumes the 45 covers deck and demo, with interruptions absorbed by the per-slide slack. If Q&A is carved out of the 45, the deck drops to 18 minutes and slide 4 goes.
2. **Do you want the Open call back as a closer?** Covered in the arithmetic section above. With roughly 20 minutes of demo time, the not-canned proof can be something they watch rather than something you offer. It costs about two minutes.
3. **Re-walk the main call before you present.** Not a question, a dependency. The optional-comparison suggestion returned `none` on the last recorded live walk and the fix has not been walked since. See the risk section above.
