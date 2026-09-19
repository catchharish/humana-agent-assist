import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { NUDGE_PRICING } from "@/lib/copy";
import * as copilot from "@/lib/copilot";
import type { Interpretation } from "@/lib/interpret";
import { createSession, ingestTranscript, upsertNeed } from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

const disclosures = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/disclosures.json"), "utf8"),
).requirements as DisclosureRequirement[];

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

function discards(sessionId: string) {
  const log = readFileSync(
    join(process.cwd(), "runs", `${sessionId}.jsonl`),
    "utf8",
  );
  const fields = [...log.matchAll(/"kind":"luna_stale_discard"[^}]*"field":"([^"]+)"/g)].map(
    (m) => m[1],
  );
  return { log, fields };
}

describe("per-field luna apply", () => {
  afterEach(() => {
    copilot.resetLunaTestHooks();
  });

  it("a: late stage-2 trigger still marks missed pricing and shows the nudge", async () => {
    const session = createSession({
      disclosures,
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    upsertNeed(session, "historical_price", { status: "active" });
    upsertNeed(session, "prospective_comparison", { status: "active" });
    copilot.setLunaTestHooks({
      interpret: async () => interp({ smallTalkOnly: true }),
      delayTrigger: { eventId: "n-est", ms: 80 },
      triggerResult: {
        fired: true,
        classification: "prospective_estimate",
        stage: 2,
        modelCall: true,
        reason: "test",
        latencyMs: 1,
        ttftMs: 1,
      },
    });
    ingestTranscript(session, {
      id: "n-est",
      speaker: "advocate",
      stability: "final",
      text: "Lakeview is fifteen dollars",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "n-est",
      speaker: "advocate",
      stability: "final",
      text: "Lakeview is fifteen dollars",
      offsetMs: 4000,
    });
    ingestTranscript(session, {
      id: "nplus1",
      speaker: "member",
      stability: "final",
      text: "ok",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "nplus1",
      speaker: "member",
      stability: "final",
      text: "ok",
    });
    expect(session.pricing).not.toBe("late_finding");
    await new Promise((r) => setTimeout(r, 150));
    expect(session.pricing).toBe("late_finding");
    expect(session.nudge?.template).toBe(NUDGE_PRICING);
    expect(session.pricingNote).toBe(
      "Deadline crossed without a qualifying reading.",
    );
    expect(discards(session.sessionId).log).not.toMatch(
      /"kind":"luna_stale_discard"[^}]*"field":"trigger"/,
    );
  });

  it("b: member need at N still registers after a filler N+1", async () => {
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    copilot.setLunaTestHooks({
      interpret: async (_s, line) => {
        if (line.id === "n") {
          return interp({
            historicalAsked: true,
            raw: "n-need",
          });
        }
        return interp({ smallTalkOnly: true, raw: "filler" });
      },
      delayApply: { eventId: "n", ms: 80 },
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "n",
      speaker: "member",
      stability: "final",
      text: "why was last month eleven and yesterday forty",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "nplus1",
      speaker: "member",
      stability: "final",
      text: "anyway",
    });
    await new Promise((r) => setTimeout(r, 150));
    const hist = session.needs.find((n) => n.kind === "historical_price");
    expect(hist?.sourceUtteranceId).toBe("n");
    expect(hist).toBeTruthy();
  });

  it("c: consent for Q1 is discarded after Q2 is asked", async () => {
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    const q1 =
      "To confirm: would you like to hear the retail and delivery estimates for both of your existing medicines? Hearing those estimates does not enroll you in anything.";
    const q2 = "Do you want me to submit the enrollment we just scoped?";
    session.consent.clarification = q1;
    ingestTranscript(session, {
      id: "q1",
      speaker: "advocate",
      stability: "final",
      text: q1,
    });
    copilot.setLunaTestHooks({
      interpret: async (_s, line) => {
        if (line.id === "n") {
          return interp({ comparisonConsent: "absolute_yes" });
        }
        return interp({ smallTalkOnly: true });
      },
      delayApply: { eventId: "n", ms: 80 },
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "n",
      speaker: "member",
      stability: "final",
      text: "yes I do",
    });
    ingestTranscript(session, {
      id: "q2",
      speaker: "advocate",
      stability: "final",
      text: q2,
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "q2",
      speaker: "advocate",
      stability: "final",
      text: q2,
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(session.consent.comparison).not.toBe("absolute_yes");
    expect(discards(session.sessionId).fields).toContain("consent");
  });

  it("d: focus and call type from N are discarded after N+1", async () => {
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    session.prefetch = {
      refill: {
        requestId: "DEMO-RF001",
        pharmacyName: "Lakeview Pharmacy",
        fillStatus: "received",
      },
      refillFresh: {
        requestId: "DEMO-RF001",
        pharmacyName: "Lakeview Pharmacy",
        fillStatus: "READY_FOR_PICKUP",
      },
      claims: [],
      classifications: [],
      fast90: null,
      serviceGuide: null,
      objection: null,
      prescriptions: [],
      contactPreferences: null,
    };
    copilot.setLunaTestHooks({
      interpret: async (_s, line) => {
        if (line.id === "n") {
          return interp({
            callTypeChange: "Education / enrollment",
            historicalAsked: true,
          });
        }
        return interp({
          callTypeChange: "General inquiry / unclassified",
          refillCheck: "existing_request",
        });
      },
      delayApply: { eventId: "n", ms: 80 },
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "n",
      speaker: "member",
      stability: "final",
      text: "why was last month eleven and yesterday forty",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "nplus1",
      speaker: "member",
      stability: "final",
      text: "did the bottle I already asked for show up",
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(session.callType).toBe("General inquiry / unclassified");
    expect(session.currentNeed).toMatch(/refill/i);
    expect(
      session.needs.find((n) => n.kind === "historical_price")?.sourceUtteranceId,
    ).toBe("n");
    const { fields } = discards(session.sessionId);
    expect(fields).toContain("callType");
    expect(fields).toContain("focus");
  });
});
