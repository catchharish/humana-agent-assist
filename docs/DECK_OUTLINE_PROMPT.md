# Prompt: build the Humana interview slide outline

Paste everything below into a new session that has access to `/Users/harishkrishnan/projects/humana-agent-assist`.

---

You are helping me prepare a 30-minute presentation for a Senior AI Product Manager interview at Humana. I built a working prototype for their take-home: an agent-assist copilot for contact-center advocates on regulated Medicare calls. Your job is to produce a slide-by-slide outline dense enough to hand straight to a slide design tool.

## Step 0 — Read before you write. This is not optional.

Everything you need is in the repo. Read these in full, in this order, before writing a single slide. Several are long; read them in chunks rather than skipping.

| File | What it is |
|---|---|
| `docs/humana_question_prompt.md` | The assignment. Read twice. Note the evaluation table and the "Show your thinking" bullets. |
| `docs/FINAL_PRODUCT_DECISIONS.md` | The product contract, ~1,100 lines, 31 sections. **Read all of it.** |
| `DECISIONS_LOG.md` | 129 lines of dated engineering decisions with real measurements. |
| `SUBMISSION.md` | The five required deliverables, already written as prose. |
| `README.md` | How to run it, what is real versus simulated, known limitations. |
| `STATUS.md` | What is broken right now. |
| `PLAN.md` | As-built architecture and recorded overrides. |
| `docs/DECK_SYNTHESIS.md` | An earlier synthesis. Useful, but several claims in it conflict with the contract. Verify every number against `FINAL_PRODUCT_DECISIONS.md` and `DECISIONS_LOG.md` before using it. |

Sections of `FINAL_PRODUCT_DECISIONS.md` that carry the strongest material and are easy to skip: §12 trust, failure and recovery · §13 conversation state and the five call-type families · §14 the five UI regions and the attention rules · §15 the fictional world, including the exact disclosure trigger rules in D13-E and the comparison arithmetic in D13-C · §17 retrieval · §18 evaluation method · §19 the golden cases · §21 the ten hard-failure meanings · §22 instrumentation and timing targets · §24 success metrics · §31.3 the decision register D01 to D14 with a downside column.

**Before writing anything, output a reading report:** for each file, three lines on what it contains plus the three most useful facts you found in it. I will check this. If you write slides before the reading report, start over.

## Step 1 — The constraints

- 30 minutes total. **The live demo is capped at 8 minutes** by §10, which also gives a named cut order and the beats that must never be cut. Respect both.
- That leaves about 22 minutes of slides. Target 14 to 16 slides.
- The demo runs live on my machine. Slides set it up and pay it off; they do not replace it.
- Assume the panel interrupts. Anything that must be said has to appear early enough to survive that.

## Step 2 — Coverage you must prove

The brief scores seven dimensions. Tag every slide with the dimension it serves and give me a coverage table at the end.

Problem and user insight · AI that does real work, not a wrapper · Journey mapping, current to future to how the product gets there · Execution · Judgment · Responsible AI · Thinking and accumulated judgment, weighted as heavily as the prototype.

The brief also names four things under "Show your thinking," and each needs real estate, not a bullet:

1. The decisions behind the work: what was considered, what was chosen, and **what was deliberately not built**, with reasons. Rejected alternatives and deliberate non-builds are different questions. Cover both.
2. Assumptions about members, advocates, data and constraints, in those four categories. §28 is already written that way. Pair each with what would invalidate it.
3. How past experience shaped the approach, one or two things, placed on the slide the lesson actually shaped rather than collected at the end.
4. What I would do next with more time, and what I would do differently.

Also cover architecture and platform fit, which §31.1 treats as its own row even though the brief's table does not name it.

## Step 3 — The quality bar

**Mechanisms beat positions.** "Compliance is the business outcome" is a claim anyone can make. "A generic remark that prices can vary names no option and no amount, so it does not fire the pricing requirement" is a claim only someone who built this can make. Every slide should carry at least one specific the contract supplies: a trigger rule, a number, a named record, a counting method, a measured latency. Hunt for these. They are the entire differentiator.

**Cite the section on every slide** so I can verify you did not invent it.

**Claim discipline, which matters more here than polish.** Say "designed" where something is designed and "built" where it is built. §27 sets explicit limits on what may be claimed about my past work, including what I personally owned versus what engineering owned. Respect them exactly and put the limits on the slide rather than hiding them. Never present a number as a Humana forecast when it is another product's reported outcome. Never present a target as an achieved result.

**Style.** Plain English. Short sentences. No aphorisms built on abstract verbs, nothing like "no system holds the call." No stacked "X is not Y" slogans. No shell-noun-plus-colon openers such as "Bottom line:" or "Key takeaway:". No em dashes, use a comma, colon or en dash. Start with the substance, cut hollow transitions, cut defensive hedging. Concrete nouns and strong verbs. If a line would need decoding, rewrite it as what actually happens.

**Do not decide scope for me.** Where there is a real choice, such as slide count against demo length, or which of two defensible orders to run the demo in, lay out the options with their trade-offs and let me choose. Do not silently pick one.

## Step 4 — Output format

One block per slide, in this shape. Keep it structured so a design tool can consume it directly.

```
SLIDE n — <title, 3 to 7 words, a statement not a label>
DIMENSION: <which rubric dimension this scores>
SOURCE: <§ references>
CLAIM: <one sentence, the single thing this slide asserts>
LAYOUT: <table | two-column comparison | matrix | numbered path | metric row | bullets with one callout>
CONTENT:
  <the actual slide content, written as it should appear. If a table, give headers and rows.
   If bullets, give the real text, not placeholders. Bold the 2 or 3 phrases that carry the argument.>
DENSITY: <word count of the body>
SAY: <the spoken track, 40 to 90 seconds, written as sentences I can read>
PROBE: <the question a Director of Product will ask, and the answer in one or two lines>
```

**Density target: 60 to 110 words of body per slide.** These are information-dense slides for a working conversation, not a keynote. Every slide gets one structural element, a table, a comparison, a matrix or a numbered path. No slide is five airy bullets, and no slide is a paragraph.

Put the demo slide in the same format, but its content is the run order, the beats that must never be cut, the cut order, and the lines I narrate as each beat happens.

## Step 5 — Flag, do not resolve

Some facts conflict across files, usually because they measure different things or come from different runs. Flag them in a section at the end and tell me what each one actually measures. Do not pick one silently.

Known ones to check and report on:

- **Latency.** `DECK_SYNTHESIS.md` quotes a 0.9 second warm median. `SUBMISSION.md` explicitly forbids citing the 899 ms warm-up figure as the accepted-run number and gives a different one. `DECISIONS_LOG.md` has a third set from the priority-tier measurement. Work out which measures which path and tell me which belongs on the latency slide.
- **The chain evaluation.** One source says 10 of 10 with none over 8 seconds. Another reports an answer at 9,647 ms against an 8-second target. Check whether these are the same run.
- **Retry behavior.** The synthesis describes a retry, the README lists read-retry as not built, and §29 rejects a generic retry. Establish how many distinct things are being called "retry."
- **Feedback capture.** Thumbs and reasons appear in the synthesis. Confirm whether they are in the running build and what they actually do.

Also read `STATUS.md` and tell me plainly which demo beats are at risk right now, including whether any of them are on the never-cut list in §10.

## Anti-patterns

Do not do any of these. Each one has already gone wrong on this project.

- Writing slides from `SUBMISSION.md` and the synthesis alone. Those are summaries. The reasoning is in the contract and the decisions log.
- Opening the deck by describing what the product does. Open on the decision that made it that product, with the alternative that was rejected.
- Collecting all the "thinking" material at the end, where the clock runs out on the dimension weighted most heavily.
- Treating rejected alternatives and deliberate non-builds as the same slide.
- Leaving assumptions in an appendix when the brief names them as a scored item.
- Inventing a demo length. §10 sets it.
- Adding slides without saying what has to give. Do the arithmetic against 22 minutes and show it.
- Claiming a capability that only exists as a design.

Start with the reading report.
