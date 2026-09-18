import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { applyAdvocateObligations } from "@/lib/copilot";
import { isExactReading } from "@/lib/exactness";
import { createSession, ingestTranscript, upsertNeed } from "@/lib/session";
import { classifyPricingTrigger } from "@/lib/triggers";
import type { DisclosureRequirement } from "@/lib/types";
import { AI_TOOL_NAMES } from "@/lib/enrollmentToken";

const GREETING =
  "Thank you for calling Humana. This call is being recorded.";
const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";

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
    expect(isExactReading(PRICING.replace(",", ","), PRICING)).toBe(true);
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

  it("does not stitch two incomplete attempts into a pass", () => {
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
    expect(session.greeting).toBe("due_now");
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

  it("has no consent-attestation path in the AI tool list", () => {
    expect(AI_TOOL_NAMES.join(" ")).not.toMatch(/attest/i);
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
      text: "You want to enroll for future fills. The estimate we discussed was $18.",
    });
    expect(session.pricingNote).toBe(note);
    expect(session.pricing).toBe(pricing);
    expect(session.nudge).toBeNull();
    expect(session.diagnostics.triggers.some((t) => t.suppressed)).toBe(true);
  });
});
