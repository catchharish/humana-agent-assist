import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { applyAdvocateObligations } from "@/lib/copilot";
import { isExactReading } from "@/lib/exactness";
import { createSession, ingestTranscript, upsertNeed } from "@/lib/session";
import { classifyPricingTrigger } from "@/lib/triggers";
import type { DisclosureRequirement } from "@/lib/types";

const GREETING =
  "Thank you for calling Humana. This call is being recorded.";
const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";
const CLOSING =
  "Your decision today has no impact on your plan membership.";

function disclosures(): DisclosureRequirement[] {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "fixtures/disclosures.json"),
      "utf8",
    ),
  ).requirements;
}

describe("C01 disclosure / deadlines", () => {
  it("accepts punctuation-only differences", () => {
    expect(isExactReading(GREETING + "!", GREETING)).toBe(true);
    expect(isExactReading(PRICING.replace(",", ""), PRICING)).toBe(true);
    expect(isExactReading(`${PRICING}?`, PRICING)).toBe(true);
  });

  it("rejects a material word change", () => {
    expect(
      isExactReading(
        "Thank you for calling Humana. This call may be recorded.",
        GREETING,
      ),
    ).toBe(false);
  });

  it("never verifies a member saying the greeting", () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    ingestTranscript(session, {
      id: "m1",
      speaker: "member",
      stability: "final",
      text: GREETING,
    });
    expect(session.greeting).toBe("due_now");
  });

  it("stitches adjacent same-speaker final segments of one reading", () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    ingestTranscript(session, {
      id: "a",
      speaker: "advocate",
      stability: "final",
      text: "Thank you for calling Humana.",
    });
    ingestTranscript(session, {
      id: "b",
      speaker: "advocate",
      stability: "final",
      text: "This call is being recorded.",
    });
    expect(session.greeting).toBe("exact_timely");
  });

  it("does not stitch across another speaker", () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    ingestTranscript(session, {
      id: "a",
      speaker: "advocate",
      stability: "final",
      text: "Thank you for calling Humana.",
    });
    ingestTranscript(session, {
      id: "m",
      speaker: "member",
      stability: "final",
      text: "Hi.",
    });
    ingestTranscript(session, {
      id: "b",
      speaker: "advocate",
      stability: "final",
      text: "This call is being recorded.",
    });
    expect(session.greeting).not.toBe("exact_timely");
  });

  it("clean pre-quote reading is timely", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    await applyAdvocateObligations(session, {
      id: "exact",
      speaker: "advocate",
      stability: "final",
      text: PRICING,
      offsetMs: 100,
    });
    expect(session.pricingExactDelivered).toBe(true);
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    await applyAdvocateObligations(session, {
      id: "est",
      speaker: "advocate",
      stability: "final",
      text: "The Lakeview estimate is fifteen dollars",
      offsetMs: 200,
    });
    expect(session.pricing).not.toBe("late_finding");
  });

  it("an earlier estimate moves the deadline to a late finding", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    await applyAdvocateObligations(session, {
      id: "est1",
      speaker: "advocate",
      stability: "final",
      text: "The Oak Street 90-day estimate is eighteen dollars",
    });
    expect(session.pricing).toBe("late_finding");
  });

  it("uncertain evidence does not verify greeting", () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    ingestTranscript(session, {
      id: "u",
      speaker: "advocate",
      stability: "uncertain",
      text: GREETING,
    });
    expect(session.greeting).not.toBe("exact_timely");
  });

  it("comparative language about a named option is not a silent stage-1 miss", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    const result = await classifyPricingTrigger(session, {
      speaker: "advocate",
      stability: "final",
      text: "about six dollars cheaper at CenterWell",
    });
    expect(result.reason).toBe("ambiguous_deferred_to_utterance_interpret");
  });

  it("wrong speaker never verifies pricing or closing", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    session.closing = "due_now";
    await applyAdvocateObligations(session, {
      id: "m",
      speaker: "member",
      stability: "final",
      text: PRICING,
    });
    expect(session.pricingExactDelivered).toBe(false);
    ingestTranscript(session, {
      id: "mc",
      speaker: "member",
      stability: "final",
      text: "Your decision today has no impact on your plan membership.",
    });
    expect(session.closing).toBe("due_now");
  });

  it("stage-1 fires on Lakeview estimate during prospective comparison without a model call", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    const result = await classifyPricingTrigger(session, {
      speaker: "advocate",
      stability: "final",
      text: "The Lakeview estimate is fifteen dollars",
    });
    expect(result.stage).toBe(1);
    expect(result.fired).toBe(true);
    expect(result.modelCall).toBe(false);
  });

  it("does not stage-1 fire on a generic remark that prices vary", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    const result = await classifyPricingTrigger(session, {
      speaker: "advocate",
      stability: "final",
      text: "prices can vary by pharmacy",
    });
    expect(result.fired).toBe(false);
    expect(result.modelCall).toBe(false);
  });

  it("has no consent-attestation path on human enrollment routes", () => {
    expect(String(applyAdvocateObligations)).not.toMatch(/attest/i);
  });

  it("second estimate after exact late delivery does not change note or nudge", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    await applyAdvocateObligations(session, {
      id: "est1",
      speaker: "advocate",
      stability: "final",
      text: "The Oak Street 90-day estimate is eighteen dollars",
    });
    expect(session.pricing).toBe("late_finding");
    expect(session.pricingNote).toBe(
      "Deadline crossed without a qualifying reading.",
    );
    expect(session.nudge?.template).toBeTruthy();
    await applyAdvocateObligations(session, {
      id: "exact",
      speaker: "advocate",
      stability: "final",
      text: PRICING,
    });
    expect(session.pricingNote).toBe("Delivered correctly, but late.");
    expect(session.nudge).toBeNull();
    const note = session.pricingNote;
    const pricing = session.pricing;
    await applyAdvocateObligations(session, {
      id: "readback",
      speaker: "advocate",
      stability: "final",
      text: "The Oak Street 90-day estimate is still eighteen dollars",
    });
    expect(session.pricingNote).toBe(note);
    expect(session.pricing).toBe(pricing);
    expect(session.nudge).toBeNull();
    expect(session.diagnostics.triggers.some((t) => t.suppressed)).toBe(true);
  });

  it("stitches adjacent advocate finals of the pricing reading", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    ingestTranscript(session, {
      id: "p1",
      speaker: "advocate",
      stability: "final",
      text: "Any price estimate we discuss is based on the information available today",
    });
    await applyAdvocateObligations(session, {
      id: "p1",
      speaker: "advocate",
      stability: "final",
      text: "Any price estimate we discuss is based on the information available today",
    });
    ingestTranscript(session, {
      id: "p2",
      speaker: "advocate",
      stability: "final",
      text: "and may change when your prescription is filled.",
    });
    await applyAdvocateObligations(session, {
      id: "p2",
      speaker: "advocate",
      stability: "final",
      text: "and may change when your prescription is filled.",
    });
    expect(session.pricingExactDelivered).toBe(true);
    expect(session.pricing).toBe("exact_timely");
  });

  it("stitches adjacent advocate finals of the closing reading", async () => {
    const session = createSession({
      disclosures: disclosures(),
      disclosureFetch: "test",
    });
    session.closing = "due_now";
    ingestTranscript(session, {
      id: "c1",
      speaker: "advocate",
      stability: "final",
      text: CLOSING.slice(0, "Your decision today has no impact".length),
    });
    await applyAdvocateObligations(session, {
      id: "c1",
      speaker: "advocate",
      stability: "final",
      text: CLOSING.slice(0, "Your decision today has no impact".length),
    });
    ingestTranscript(session, {
      id: "c2",
      speaker: "advocate",
      stability: "final",
      text: CLOSING.slice("Your decision today has no impact".length).trim(),
    });
    await applyAdvocateObligations(session, {
      id: "c2",
      speaker: "advocate",
      stability: "final",
      text: CLOSING.slice("Your decision today has no impact".length).trim(),
    });
    expect(session.closing).toBe("exact_timely");
  });
});
