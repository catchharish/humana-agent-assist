import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import * as copilot from "@/lib/copilot";
import type { Interpretation } from "@/lib/interpret";
import { finalCompatibleWithPartial } from "@/lib/interpret";
import { isExactReading, isWordingAttempt } from "@/lib/exactness";
import {
  consumeEnrollmentToken,
  mintEnrollmentToken,
} from "@/lib/enrollmentToken";
import { createSession, ingestTranscript, showNow, upsertNeed } from "@/lib/session";
import { classifyPricingTrigger, hasAmount } from "@/lib/triggers";
import {
  classifyEnrollmentConsent,
  type UtteranceRules,
} from "@/lib/utteranceRules";
import type { DisclosureRequirement } from "@/lib/types";

const disclosures = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/disclosures.json"), "utf8"),
).requirements as DisclosureRequirement[];

const rules = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/utterance_rules.json"), "utf8"),
) as UtteranceRules;

const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";
const GREETING =
  "Thank you for calling Humana. This call is being recorded.";

function interp(over: Partial<Interpretation>): Interpretation {
  return {
    callTypeChange: null,
    refillCheck: "none",
    historicalAsked: false,
    returnToHistorical: false,
    communicatedRefillReadiness: false,
    ninetyDayAsked: false,
    retailHesitation: false,
    serviceIntroducedByAdvocate: false,
    comparisonConsent: "none",
    enrollmentConsent: "none",
    electionMetforminOnly: false,
    electedMedications: [],
    coverageAsked: false,
    memberAgreesTransfer: false,
    advocateOfferedTransfer: false,
    firmRefusal: false,
    smallTalkOnly: false,
    withdrawEnrollment: false,
    quotePharmacy: null,
    quotePharmacyCorrection: false,
    quoteDrug: null,
    pricingTrigger: "none",
    focusKind: null,
    raw: "",
    ms: 1,
    ttftMs: 1,
    usage: null,
    ok: true,
    ...over,
  };
}

describe("review fixes F1–F15, F18, F26–F28", () => {
  afterEach(() => copilot.resetLunaTestHooks());

  it("F1 advocate luna consent does not authorize enrollment", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    session.enrollment.medications = ["metformin"];
    session.enrollment.readback = "readback";
    copilot.setLunaTestHooks({
      interpret: async () =>
        interp({ enrollmentConsent: "absolute_yes", comparisonConsent: "absolute_yes" }),
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "adv-yes",
      speaker: "advocate",
      stability: "final",
      text: "Yes, for metformin only.",
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(session.consent.enrollment).not.toBe("absolute_yes");
    expect(session.consent.comparison).not.toBe("absolute_yes");
  });

  it("F2 scope change resets enrollment consent and tokens", () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    session.consent.enrollment = "absolute_yes";
    session.consent.enrollmentScopeKey = "metformin";
    session.enrollment.medications = ["metformin"];
    const token = mintEnrollmentToken(session.sessionId, {
      medications: ["metformin"],
    });
    copilot.setEnrollmentMedications(session, ["atorvastatin"]);
    expect(session.consent.enrollment).toBe("none");
    expect(session.enrollment.confirmed).toBe(false);
    const used = consumeEnrollmentToken(token, { medications: ["metformin"] });
    expect(used.ok).toBe(false);
  });

  it("F3 hedged or wrong-scope or no-readback enrollment is not absolute yes", () => {
    const base = {
      rules,
      speaker: "member" as const,
      stability: "final",
      draftMedications: ["metformin"],
      readback: "You want to enroll in the service for future metformin fills.",
    };
    expect(
      classifyEnrollmentConsent({
        ...base,
        text: "Yes, for now, I guess.",
        readbackPending: true,
      }),
    ).toBe("hedge");
    expect(
      classifyEnrollmentConsent({
        ...base,
        text: "Yes, for both of them.",
        readbackPending: true,
      }),
    ).toBe("clarify");
    expect(
      classifyEnrollmentConsent({
        ...base,
        text: "Yes, for atorvastatin.",
        readbackPending: true,
      }),
    ).toBe("clarify");
    expect(
      classifyEnrollmentConsent({
        ...base,
        text: "Yes, for metformin only.",
        readbackPending: false,
      }),
    ).toBe("clarify");
    expect(
      classifyEnrollmentConsent({
        ...base,
        speaker: "advocate",
        text: "Yes, for metformin only.",
        readbackPending: true,
      }),
    ).toBe("wait");
    expect(
      classifyEnrollmentConsent({
        ...base,
        text: "Yes, for metformin only.",
        readbackPending: true,
      }),
    ).toBe("absolute_yes");
  });

  it("F4 token consume checks sessionId", () => {
    const token = mintEnrollmentToken("sess-a", { medications: ["metformin"] });
    const other = consumeEnrollmentToken(
      token,
      { medications: ["metformin"] },
      "sess-b",
    );
    expect(other.ok).toBe(false);
  });

  it("F5 does not stage-1 fire on day/quantity numbers without currency", async () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    for (const text of [
      "let me pull up the 90-day numbers",
      "Give me one second, that will be right up",
      "I have the estimates for the two medicines here",
      "Your refill will be ready in two days",
    ]) {
      expect(hasAmount(text), text).toBe(false);
      const result = await classifyPricingTrigger(session, {
        speaker: "advocate",
        stability: "final",
        text,
      });
      expect(result.fired, text).toBe(false);
    }
  });

  it("F6 comparative named-option language is stage 2 not silent", async () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    const result = await classifyPricingTrigger(session, {
      speaker: "advocate",
      stability: "final",
      text: "roughly a third of the Lakeview price",
    });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("ambiguous_deferred_to_utterance_interpret");
  });

  it("F7 filler is not a paraphrase attempt", () => {
    expect(isWordingAttempt("Okay Harry, bear with me a moment.", PRICING)).toBe(
      false,
    );
  });

  it("F8 records exact pricing before the comparison opens", async () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    await copilot.applyAdvocateObligations(session, {
      id: "pre",
      speaker: "advocate",
      stability: "final",
      text: PRICING,
      offsetMs: 1000,
    });
    expect(session.pricingExactDelivered).toBe(true);
    expect(session.pricingExactOffset).toBe(1000);
    upsertNeed(session, "prospective_comparison", { status: "active" });
    await copilot.applyAdvocateObligations(session, {
      id: "est",
      speaker: "advocate",
      stability: "final",
      text: "The Lakeview estimate is fifteen dollars",
      offsetMs: 2000,
    });
    expect(session.pricing).not.toBe("late_finding");
  });

  it("F9 greeting after auth is late and write-once after exact", () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    session.identityStatus = "VALID";
    session.auth = {
      authorizationId: "DEMO-AUTH001",
      memberId: "DEMO-M001",
      role: "pharmacy_ops",
      decision: "valid",
      permittedScopes: [],
    };
    ingestTranscript(session, {
      id: "g",
      speaker: "advocate",
      stability: "final",
      text: GREETING,
    });
    expect(session.greeting).toBe("late_finding");
    expect(session.greetingLocked).toBe(true);
    ingestTranscript(session, {
      id: "u",
      speaker: "advocate",
      stability: "uncertain",
      text: "Your decision today has no impact on your plan membership.",
    });
    expect(session.greeting).toBe("late_finding");
  });

  it("F10 late-classified earlier estimate is not suppressed as a repeat", async () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    session.pricingExactDelivered = true;
    session.pricingExactOffset = 5000;
    await copilot.applyAdvocateObligations(session, {
      id: "early-est",
      speaker: "advocate",
      stability: "final",
      text: "The Lakeview estimate is fifteen dollars",
      offsetMs: 4000,
    });
    expect(session.diagnostics.triggers.some((t) => t.suppressed)).toBe(false);
  });

  it("F12 due-now outranks a later answer card", () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    showNow(
      session,
      {
        title: "Pricing statement due now",
        body: PRICING,
        sourceLabel: "Governed guidance · scripting · simulated",
      },
      { priority: "due_now" },
    );
    showNow(
      session,
      {
        title: "Refill status (fresh read)",
        body: "ready",
        sourceLabel: "System record · pharmacy · simulated",
      },
      { priority: "answer", needKind: "refill_status" },
    );
    expect(session.nowCard.title).toBe("Pricing statement due now");
  });

  it("F13 extra words on a final are not compatible with the partial", () => {
    expect(
      finalCompatibleWithPartial("yes", "yes and atorvastatin too"),
    ).toBe(false);
  });

  it("F18 pending transfer does not confirm TRANSFERRED", () => {
    const session = createSession({ disclosures, disclosureFetch: "test" });
    session.transfer.connectionStatus = "pending";
    const r = copilot.confirmDisposition(session, "TRANSFERRED_COVERAGE_REVIEW");
    expect(r.ok).toBe(false);
    expect(session.disposition.confirmed).toBeNull();
  });
});
