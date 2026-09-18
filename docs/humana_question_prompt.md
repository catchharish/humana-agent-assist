# Use Case 2: Agent Assist for Advocates

**Every regulated call, guided as it happens — the right words, the member’s own data, the next best step, and zero after-call scramble.**

**Business area:** Contact Center — Member Services & Pharmacy Operations

**Main AI role:** A real-time co-pilot on the live call that understands what is happening, surfaces exactly what to say and do next, keeps the advocate compliant in the moment, and does the after-call work.

*This is a self-contained brief. Everything you need is in this file.*

**Why this role matters:** Agent Assist is one of the most critical initiatives at Humana. It sits on the highest-volume, most heavily regulated member touchpoint — the live call — and it is the proving ground for how AI and human advocates work together across every line of business. Done right, it lifts compliance, quality, and member experience at the same time. This is a strategic, enterprise-priority program with senior visibility, not a peripheral experiment. Whoever we hire will be building at the center of it.

## The problem

Advocates handle regulated, multi-step calls — education, enrollment, refills, pricing, do-not-call. On a single call they must say mandatory legal verbatim word-for-word, pull the member’s context from several systems, follow the correct flow for that call type, handle objections, and document the outcome accurately — all while talking to a live person. Today they do this by hunting through dense knowledge documents, switching between system tabs, and leaning on memory and tenure.

The result: missed or paraphrased legal verbatim (a real compliance risk), inconsistent answers, long handle times, heavy after-call work, and months-long ramp for new hires. The information needed is spread across benefits, eligibility, claims, pharmacy, provider, and scripting systems.

**Scenario (illustrative, made-up).** Harry calls about a refill. Mid-call it turns into an education-and-enrollment opportunity. The advocate must deliver three pieces of legal verbatim exactly, quote Harry’s real drug costs, secure an “absolute yes,” and log a clean disposition — without losing him. One missed verbatim is a compliance finding. One fumbled tab is four seconds of dead air.

## Why now

Call volume and regulatory scrutiny are rising while average tenure is falling. QA samples only a small fraction of calls, so misses surface weeks later instead of being prevented. And AI is finally good enough to follow a live conversation, ground answers in the member’s own data, and enforce verbatim in the moment. *(Any figures you cite may be illustrative — label them as such.)*

## Who it is for (pick your main user)

- Contact center advocates
- Team leads / QA & compliance

## What great looks like (and what weak looks like)

**Great:** a live call where the AI detects the intent and call type, pulls the member’s (fake) data, surfaces the exact required verbatim at the right beat, flags a missed statement in real time, and auto-drafts the wrap and warm handoff. AI clearly changes the outcome.

**Weak:** a chatbot side-panel that answers typed questions with generic content and ignores the call flow, the compliance requirement, and the after-call work. A wrapper, not a co-pilot.

## What to deliver

Build an AI-powered prototype and turn in five things.

1. **Problem Brief.** Define the problem, who it is for, and why it is worth solving now. Call out the current pain and the business opportunity.
2. **Service Design.** Current end-to-end advocate journey (before, during, after the call) and the future journey. Make the compliance and handle-time pain clear and the improvement obvious.
3. **Working Prototype.** An interactive demo (v0, Claude Code, Cursor, Replit, Lovable, Codex, or similar). Not production-ready. It **must show:** (a) live call context, (b) the correct verbatim surfaced in-flow, (c) a real-time compliance nudge when something is missed, and (d) an auto-generated wrap / handoff.
4. **Product Roadmap.** A phased plan. For each phase, explain the order and the reason.
5. **Key Tradeoff.** Name one real tradeoff you made and explain why.

## Where AI decides, recommends, or hands off

| AI decides (autonomous) | AI recommends (human confirms) | Human only (AI hands off) |
| --- | --- | --- |
| Surface the next step; detect a missed or paraphrased verbatim; draft the wrap note and disposition | Objection rebuttals; next-best-action; disposition code; when to warm-transfer | Commit an enrollment; make a coverage determination; take payment; give clinical advice |

## Sample data you can use (made-up)

- **Member:** “Harry Whitfield,” Humana MAPD, preferred cost-share. Meds: atorvastatin 20mg, metformin 500mg. Fake retail vs. CenterWell prices.
- **Three required verbatim:** greeting on a recorded line; the pricing disclaimer; the “your decision today has no impact on your plan membership” closing.
- **Flow:** educate → confirm interest (absolute yes) → price → enroll or decline → wrap.

## The mindset and experience we are looking for

This role fits someone who works the way this program is being built. We are looking for the sum of a person’s experience showing up in how they approach the problem — not a blank-slate attempt. Signals that matter:

- **A builder who prototypes to think.** You would rather show a working thing in two days than write a spec for two weeks, and you learn by building.
- **Architecture-first instincts.** You separate content from workflow, treat knowledge as a single governed source of truth, and design so one thing feeds many channels instead of creating silos.
- **Real experience in regulated, high-volume operations.** You respect legal verbatim and compliance, and you know exactly where a human must stay in the loop.
- **Reasons from the frontline pain.** You start from the member and the advocate, not from the technology.
- **Connects the piece to the whole.** You see how one use case fits the larger platform and sequence your roadmap accordingly.

If that describes how you already work, this brief should feel natural — show us your reasoning and let your past experience culminate in the approach.

## Show your thinking (weighted as heavily as the prototype)

We are hiring for judgment, not just output. Alongside what you build, make your reasoning visible — the follow-up call will go deep here.

- **The decisions behind the work.** What you considered, what you chose, and what you deliberately did not build — and why.
- **Your assumptions.** What you assumed about the members, the advocates, the data, and the constraints.
- **How your experience shaped this.** Point to one or two things from your past work that directly influenced your approach. We read the strongest submissions as the sum of everything a person has learned, applied to this problem.
- **What you would do next.** With more time — and what you would do differently knowing what you know now.

A rough prototype with sharp, well-argued thinking beats a polished demo you cannot defend.

## How we will evaluate

| Dimension | What we are checking |
| --- | --- |
| Problem & user insight | Real pain, real users, a clear “why now” |
| AI that does real work | Live context, grounding, in-the-moment verbatim/compliance, automation — not a wrapper |
| Journey mapping | Current → future → how the product gets there |
| Execution | The prototype shows the core experience convincingly |
| Judgment | Roadmap order and the chosen tradeoff |
| Responsible AI | Explicit, sensible human-in-the-loop for regulated moments |
| Thinking & accumulated judgment | Clear reasoning, considered alternatives, and prior experience that visibly shapes the approach — weighted as heavily as the prototype |

## Guidance and rules

You have 2 to 3 days. Use made-up data only — no real member, provider, or claims data.

Keep a human in the loop where it matters. Clinical, coverage, and payment decisions are regulated and serious. The AI guides; the advocate speaks and decides. The AI must never auto-commit an enrollment, coverage determination, or payment. Mandatory legal verbatim is owned and approved by Legal — the AI surfaces it, it does not invent it.

Be ready to present. The follow-up is a working conversation: we want the reasoning behind each choice, the paths you did not take, and how your experience led you here.

## Stretch (optional, for exceptional candidates)

Show the same knowledge that guided the advocate also driving the post-call QA score — guided text equals graded text — or estimate the impact on new-hire ramp time.
