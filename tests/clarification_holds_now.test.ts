import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { clarificationHoldsNow } from "@/lib/nowOccupancy";
import {
  applyAuth,
  createSession,
  ingestTranscript,
  showNow,
} from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

const disclosures = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/disclosures.json"), "utf8"),
).requirements as DisclosureRequirement[];

function blank() {
  return createSession({
    disclosures,
    disclosureFetch: "test",
  });
}

describe("clarificationHoldsNow", () => {
  it("holds when Now body is the active consent clarification", () => {
    const session = blank();
    const body =
      "To confirm: would you like to hear the retail and delivery estimates?";
    session.consent.clarification = body;
    session.nowCard = {
      title: "Clarify comparison interest",
      body,
      sourceLabel: "test",
    };
    expect(clarificationHoldsNow(session)).toBe(true);
  });

  it("does not hold when clarification was cleared", () => {
    const session = blank();
    session.consent.clarification = null;
    session.nowCard = {
      title: "Clarify comparison interest",
      body: "stale body",
      sourceLabel: "test",
    };
    expect(clarificationHoldsNow(session)).toBe(false);
  });

  it("does not hold when Now shows a different card", () => {
    const session = blank();
    session.consent.clarification = "clarify text";
    session.nowCard = {
      title: "He can keep his pharmacist and still see the prices",
      body: "objection tip body",
      sourceLabel: "test",
    };
    expect(clarificationHoldsNow(session)).toBe(false);
  });
});

describe("greeting after identity", () => {
  it("retires a paraphrased greeting nudge and card after auth", () => {
    const session = blank();
    ingestTranscript(session, {
      id: "short-greeting",
      speaker: "advocate",
      stability: "final",
      text: "Thank you for calling Humana. This call is being recorded.",
    });
    expect(session.greeting).toBe("paraphrased");
    expect(session.nudge?.requiredText).toBe(disclosures[0].verbatimText);

    applyAuth(
      session,
      {
        authorizationId: "DEMO-AUTH001",
        memberId: "DEMO-M001",
        role: "pharmacy_ops",
        decision: "valid",
        permittedScopes: [],
      },
      null,
    );
    expect(session.identityStatus).toBe("VALID");
    expect(session.greeting).toBe("late_finding");
    expect(session.nudge).toBeNull();
    expect(session.nowCard.title).toBe("");

    showNow(
      session,
      {
        title: "Current answer",
        body: "The current answer belongs on Now.",
        sourceLabel: "test",
      },
      { priority: "answer", needKind: "refill_status" },
    );
    expect(session.nowCard.title).toBe("Current answer");
  });
});
