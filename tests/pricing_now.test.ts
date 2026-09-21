import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import * as copilot from "@/lib/copilot";
import type { Interpretation } from "@/lib/interpret";
import { createSession, ingestTranscript } from "@/lib/session";
import type { UtteranceRules } from "@/lib/utteranceRules";
import type { DisclosureRequirement } from "@/lib/types";

const disclosures = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/disclosures.json"), "utf8"),
).requirements as DisclosureRequirement[];
const rules = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/utterance_rules.json"), "utf8"),
) as UtteranceRules;

const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";
const ASK =
  "To confirm: would you like to hear the retail and delivery estimates for both of your existing medicines? Hearing those estimates does not enroll you in anything.";
const ORIGIN = "http://127.0.0.1:9";

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
    lookupHold: false,
    raw: "",
    ms: 1,
    ttftMs: 1,
    usage: null,
    ok: true,
    httpStatus: 200,
    error: null,
    ...over,
  };
}

function sessionReady() {
  const session = createSession({
    disclosures,
    disclosureFetch: "test",
    utteranceRules: rules,
  });
  session.identityStatus = "VALID";
  session.quotes = [
    {
      quoteId: "DEMO-Q-ATO-L",
      drugName: "atorvastatin",
      pharmacyId: "lakeview",
      pharmacyName: "Lakeview Pharmacy",
      estimatedMemberCost: { value: "15.00", currency: "USD" },
      daysSupply: 90,
      quantity: 90,
      validityStatus: "valid",
    },
  ];
  return session;
}

async function waitApplied(session: { lastAppliedEventId: string | null }, id: string) {
  const start = Date.now();
  while (session.lastAppliedEventId !== id && Date.now() - start < 8000) {
    await new Promise((r) => setTimeout(r, 40));
  }
  expect(session.lastAppliedEventId).toBe(id);
}

describe("pricing due-now vs clarify (D11 / §14)", () => {
  afterEach(() => copilot.resetLunaTestHooks());

  it("a: hedge → clarify → code yes clears Clarify; pricing due now on Now; quotes demoted-ready", async () => {
    const session = sessionReady();
    ingestTranscript(session, {
      id: "e-ask",
      speaker: "advocate",
      stability: "final",
      text: ASK,
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-ask",
      speaker: "advocate",
      stability: "final",
      text: ASK,
    });
    expect(session.pricing).toBe("pending_later");
    ingestTranscript(session, {
      id: "e-hedge",
      speaker: "member",
      stability: "final",
      text: "Yeah, I guess, sure",
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-hedge",
      speaker: "member",
      stability: "final",
      text: "Yeah, I guess, sure",
    });
    expect(session.nowCard.title).toBe("Clarify comparison interest");
    expect(session.consent.clarification).toBeTruthy();
    expect(session.nowCardNeedKind).toBeNull();
    expect(session.nowCard.usedSources ?? []).toEqual([]);
    expect(session.pricing).toBe("pending_later");

    ingestTranscript(session, {
      id: "e-yes-compare",
      speaker: "member",
      stability: "final",
      text: "Yes, please compare both.",
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-yes-compare",
      speaker: "member",
      stability: "final",
      text: "Yes, please compare both.",
    });
    expect(session.consent.comparison).toBe("absolute_yes");
    expect(session.consent.clarification).toBeNull();
    expect(session.pricing).toBe("due_now");
    expect(session.nowCard.title).toBe("Pricing statement due now");
    expect(session.nowCard.body).toBe(PRICING);
    expect(session.nowCard.body).not.toMatch(/\$15/);
    const need = session.needs.find((n) => n.kind === "prospective_comparison");
    expect(need?.guidance).toBe("ready");
    expect(need?.flowStep).toMatch(/demoted/);
    expect(need?.answer?.body).toMatch(/\$15/);
  });

  it("b: paraphrased yes through luna after 1.5s, not 30ms", async () => {
    const session = sessionReady();
    ingestTranscript(session, {
      id: "e-ask",
      speaker: "advocate",
      stability: "final",
      text: ASK,
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-ask",
      speaker: "advocate",
      stability: "final",
      text: ASK,
    });
    ingestTranscript(session, {
      id: "e-hedge",
      speaker: "member",
      stability: "final",
      text: "Yeah, I guess, sure",
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-hedge",
      speaker: "member",
      stability: "final",
      text: "Yeah, I guess, sure",
    });
    expect(session.nowCard.title).toBe("Clarify comparison interest");

    copilot.setLunaTestHooks({
      delayApply: { eventId: "e-luna-yes", ms: 1500 },
      interpret: async () => interp({ comparisonConsent: "absolute_yes" }),
    });
    const lunaText = "I want you to compare both pharmacies.";
    ingestTranscript(session, {
      id: "e-luna-yes",
      speaker: "member",
      stability: "final",
      text: lunaText,
    });
    const t0 = Date.now();
    await copilot.processTranscriptEvent(session, ORIGIN, {
      id: "e-luna-yes",
      speaker: "member",
      stability: "final",
      text: lunaText,
    });
    expect(session.consent.comparison).not.toBe("absolute_yes");
    expect(session.nowCard.title).toBe("Clarify comparison interest");
    await waitApplied(session, "e-luna-yes");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    expect(session.consent.comparison).toBe("absolute_yes");
    expect(session.consent.clarification).toBeNull();
    expect(session.pricing).toBe("due_now");
    expect(session.nowCard.title).toBe("Pricing statement due now");
    expect(session.nowCard.body).toBe(PRICING);
    expect(
      session.needs.find((n) => n.kind === "prospective_comparison")?.guidance,
    ).toBe("ready");
  });

  it("c: spoken estimate before consent: due-now on Now; Clarify stays in open needs", async () => {
    const session = sessionReady();
    ingestTranscript(session, {
      id: "e-ask",
      speaker: "advocate",
      stability: "final",
      text: ASK,
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-ask",
      speaker: "advocate",
      stability: "final",
      text: ASK,
    });
    ingestTranscript(session, {
      id: "e-hedge",
      speaker: "member",
      stability: "final",
      text: "Yeah, I guess, sure",
    });
    await copilot.applyGovernedUtteranceRules(session, ORIGIN, {
      id: "e-hedge",
      speaker: "member",
      stability: "final",
      text: "Yeah, I guess, sure",
    });
    expect(session.consent.comparison).toBe("hedge");
    expect(session.nowCard.title).toBe("Clarify comparison interest");

    ingestTranscript(session, {
      id: "e-price-miss",
      speaker: "advocate",
      stability: "final",
      text: "For a 90-day atorvastatin supply, the Lakeview estimate is fifteen dollars.",
    });
    await copilot.applyAdvocateObligations(session, {
      id: "e-price-miss",
      speaker: "advocate",
      stability: "final",
      text: "For a 90-day atorvastatin supply, the Lakeview estimate is fifteen dollars.",
    });
    expect(session.consent.comparison).toBe("hedge");
    expect(session.consent.clarification).toBeTruthy();
    expect(session.nowCard.title).toBe("Pricing statement due now");
    expect(session.nowCard.body).toBe(PRICING);
    expect(["due_now", "late_finding"]).toContain(session.pricing);
  });
});
