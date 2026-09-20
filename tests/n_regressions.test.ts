import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import * as copilot from "@/lib/copilot";
import type { Interpretation } from "@/lib/interpret";
import {
  beginPause,
  createSession,
  ingestTranscript,
  showNow,
  upsertNeed,
} from "@/lib/session";
import {
  classifyEnrollmentConsent,
  isDirectNamedQuoteAsk,
  type UtteranceRules,
} from "@/lib/utteranceRules";
import type { DisclosureRequirement } from "@/lib/types";

const disclosures = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/disclosures.json"), "utf8"),
).requirements as DisclosureRequirement[];
const rules = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/utterance_rules.json"), "utf8"),
) as UtteranceRules;
const t01 = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/streams/t01_m2a.json"), "utf8"),
) as { events: Array<Record<string, string>> };

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
    httpStatus: 200,
    error: null,
    ...over,
  };
}

const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";

describe("N1–N10 regressions", () => {
  afterEach(() => copilot.resetLunaTestHooks());

  it("N1 drops now-card latch after exact pricing so later answers paint", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    session.pricing = "due_now";
    session.currentNeed = "prospective comparison";
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
        title: "Coverage case status (read only)",
        body: "pending",
        sourceLabel: "System record · coverage-review · simulated",
      },
      { priority: "answer", needKind: "coverage_status" },
    );
    expect(session.nowCard.title).toBe("Pricing statement due now");
    await copilot.applyAdvocateObligations(session, {
      id: "exact",
      speaker: "advocate",
      stability: "final",
      text: PRICING,
    });
    session.currentNeed = "coverage status";
    showNow(
      session,
      {
        title: "Coverage case status (read only)",
        body: "DEMO-CVR001 pending",
        sourceLabel: "System record · coverage-review · simulated",
      },
      { priority: "answer", needKind: "coverage_status" },
    );
    expect(session.nowCard.title).toBe("Coverage case status (read only)");
  });

  it("N1 T01 pause gates record Now titles including paraphrase and no enrollment latch", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    session.pricing = "due_now";
    upsertNeed(session, "prospective_comparison", { status: "active" });
    session.currentNeed = "prospective comparison";
    session.quotes = [
      {
        quoteId: "q1",
        drugName: "atorvastatin",
        pharmacyName: "Lakeview Pharmacy",
        estimatedMemberCost: { value: "15", currency: "USD" },
        daysSupply: 90,
        quantity: 1,
        validityStatus: "valid",
      },
    ];
    showNow(
      session,
      {
        title: "Pricing statement due now",
        body: PRICING,
        sourceLabel: "Governed guidance · scripting · simulated",
      },
      { priority: "due_now" },
    );
    beginPause(
      session,
      t01.events.find((e) => e.id === "e-pause-quotes")?.pauseLabel ?? "",
    );
    session.paused = false;
    session.pauseStartedAt = null;
    await copilot.applyAdvocateObligations(session, {
      id: "e-price-miss",
      speaker: "advocate",
      stability: "final",
      text: "For a 90-day atorvastatin supply, the Lakeview estimate is fifteen dollars.",
    });
    beginPause(
      session,
      t01.events.find((e) => e.id === "e-pause-nudge")?.pauseLabel ?? "",
    );
    session.paused = false;
    session.pauseStartedAt = null;
    await copilot.applyAdvocateObligations(session, {
      id: "e-paraphrase",
      speaker: "advocate",
      stability: "final",
      text: "These prices might change.",
    });
    beginPause(
      session,
      t01.events.find((e) => e.id === "e-pause-para")?.pauseLabel ?? "",
    );
    expect(
      session.diagnostics.pauseSnapshots.find((p) =>
        /Paraphrase flagged/i.test(p.label),
      )?.nowTitle,
    ).not.toBe("Opening");
    expect(session.nudge?.heard).toMatch(/prices might change/i);

    copilot.setEnrollmentMedications(session, ["metformin"]);
    ingestTranscript(session, {
      id: "e-elect",
      speaker: "member",
      stability: "final",
      text: "Keep the atorvastatin at retail. I would like to try delivery for the metformin.",
    });
    await copilot.applyGovernedUtteranceRules(session, "http://127.0.0.1:9", {
      id: "e-elect",
      speaker: "member",
      stability: "final",
      text: "Keep the atorvastatin at retail. I would like to try delivery for the metformin.",
    });
    expect(session.nowCard.title).not.toBe("Clarify enrollment");
    expect(session.consent.enrollment).not.toBe("hedge");
  });

  it("N2 waits for the current readback and shows it; later lines do not re-consent", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    copilot.setEnrollmentMedications(session, ["metformin"]);
    ingestTranscript(session, {
      id: "e-elect",
      speaker: "member",
      stability: "final",
      text: "delivery for the metformin",
    });
    await copilot.applyGovernedUtteranceRules(session, "http://127.0.0.1:9", {
      id: "e-elect",
      speaker: "member",
      stability: "final",
      text: "Yes",
    });
    expect(session.consent.enrollment).toBe("none");
    ingestTranscript(session, {
      id: "e-readback",
      speaker: "advocate",
      stability: "final",
      text: session.enrollment.readback,
    });
    await copilot.applyGovernedUtteranceRules(session, "http://127.0.0.1:9", {
      id: "e-yes-enroll",
      speaker: "member",
      stability: "final",
      text: "Yes, for metformin only.",
    });
    expect(session.consent.enrollment).toBe("absolute_yes");
    session.enrollment.resultId = "DEMO-ENR001";
    ingestTranscript(session, {
      id: "e-jardiance",
      speaker: "member",
      stability: "final",
      text: "My doctor also sent a request for Jardiance. Has that been approved?",
    });
    await copilot.applyGovernedUtteranceRules(session, "http://127.0.0.1:9", {
      id: "e-jardiance",
      speaker: "member",
      stability: "final",
      text: "My doctor also sent a request for Jardiance. Has that been approved?",
    });
    expect(session.consent.enrollment).toBe("absolute_yes");
    expect(session.nowCard.title).not.toBe("Clarify enrollment");
  });

  it("N4 luna y with code wait and a scoped ask is absolute yes, once", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    session.quotes = [
      {
        quoteId: "q1",
        drugName: "metformin",
        pharmacyName: "Lakeview Pharmacy",
        estimatedMemberCost: { value: "24", currency: "USD" },
        daysSupply: 90,
        quantity: 1,
        validityStatus: "valid",
      },
    ];
    const scoped =
      "To confirm: would you like to hear the retail and delivery estimates for both of your existing medicines? Hearing those estimates does not enroll you in anything.";
    ingestTranscript(session, {
      id: "adv",
      speaker: "advocate",
      stability: "final",
      text: scoped,
    });
    copilot.setLunaTestHooks({
      interpret: async () => interp({ comparisonConsent: "absolute_yes" }),
    });
    ingestTranscript(session, {
      id: "m1",
      speaker: "member",
      stability: "final",
      text: "Yes I want you to compare both pharmacies.",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "m1",
      speaker: "member",
      stability: "final",
      text: "Yes I want you to compare both pharmacies.",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(session.consent.comparison).toBe("absolute_yes");
    const title = session.nowCard.title;
    ingestTranscript(session, {
      id: "m2",
      speaker: "member",
      stability: "final",
      text: "Yes I want you to compare both pharmacies.",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "m2",
      speaker: "member",
      stability: "final",
      text: "Yes I want you to compare both pharmacies.",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(session.consent.comparison).toBe("absolute_yes");
    expect(session.nowCard.title).toBe(title);
  });

  it("N5 rejects first-word yes with contradiction or a question", () => {
    const base = {
      rules,
      speaker: "member" as const,
      stability: "final",
      draftMedications: ["metformin"],
      readback: "You want to enroll in the service for future metformin fills.",
      readbackPending: true,
    };
    for (const text of [
      "Yes, but not today.",
      "Okay, what does that cost?",
      "Sure, but let me think about it first.",
      "Yes... actually no.",
    ]) {
      expect(classifyEnrollmentConsent({ ...base, text }), text).not.toBe(
        "absolute_yes",
      );
    }
  });

  it("N6 direct quote needs a request cue, no negation, and session entities", () => {
    const entities = {
      drugs: ["metformin"],
      pharmacies: ["Lakeview Pharmacy"],
    };
    expect(
      isDirectNamedQuoteAsk(
        "Why did my metformin cost more at Lakeview last month?",
        entities,
      ),
    ).toBe(false);
    expect(
      isDirectNamedQuoteAsk("I don't want a price on metformin.", entities),
    ).toBe(false);
    expect(
      isDirectNamedQuoteAsk(
        "Can you tell me the metformin price at Lakeview Pharmacy?",
        entities,
      ),
    ).toBe(true);
  });

  it("N8 logs a discard and clarifies when a late election is not newest", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    session.quotes = [
      {
        quoteId: "q1",
        drugName: "metformin",
        pharmacyName: "Lakeview Pharmacy",
        estimatedMemberCost: { value: "24", currency: "USD" },
        daysSupply: 90,
        quantity: 1,
        validityStatus: "valid",
      },
    ];
    copilot.setLunaTestHooks({
      interpret: async () =>
        interp({
          electionMetforminOnly: true,
          electedMedications: ["metformin"],
        }),
      delayApply: { eventId: "old", ms: 30 },
    });
    ingestTranscript(session, {
      id: "old",
      speaker: "member",
      stability: "final",
      text: "delivery for the metformin",
    });
    const pending = copilot.processTranscriptEvent(
      session,
      "http://127.0.0.1:9",
      {
        id: "old",
        speaker: "member",
        stability: "final",
        text: "delivery for the metformin",
      },
    );
    session.lunaSeq += 5;
    await pending;
    await new Promise((r) => setTimeout(r, 80));
    expect(session.nowCard.title).toMatch(/clarification/i);
  });

  it("N9 advocate historicalAsked does not reopen a resolved need", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    upsertNeed(session, "historical_price", {
      status: "resolved",
      guidance: "ready",
    });
    copilot.setLunaTestHooks({
      interpret: async () => interp({ historicalAsked: true }),
    });
    ingestTranscript(session, {
      id: "a",
      speaker: "advocate",
      stability: "final",
      text: "those were the amounts you paid",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "a",
      speaker: "advocate",
      stability: "final",
      text: "those were the amounts you paid",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(
      session.needs.find((n) => n.kind === "historical_price")?.status,
    ).toBe("resolved");
  });

  it("N10 return-to-historical is servicing and does not create unrecognized_request", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
      utteranceRules: rules,
    });
    session.identityStatus = "VALID";
    upsertNeed(session, "historical_price", {
      status: "deferred",
      guidance: "deferred_valid",
      queryText: "what did I pay",
    });
    copilot.setLunaTestHooks({
      interpret: async () => interp({ returnToHistorical: true }),
    });
    ingestTranscript(session, {
      id: "m",
      speaker: "member",
      stability: "final",
      text: "So, the metformin?",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "m",
      speaker: "member",
      stability: "final",
      text: "So, the metformin?",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(session.needs.some((n) => n.kind === "unrecognized_request")).toBe(
      false,
    );
  });
});
