import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import * as copilot from "@/lib/copilot";
import type { Interpretation } from "@/lib/interpret";
import { createSession } from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

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

describe("stale luna apply", () => {
  afterEach(() => {
    copilot.resetLunaTestHooks();
  });

  it("drops a delayed interpret for utterance N after N+1 has applied", async () => {
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    copilot.setLunaTestHooks({
      interpret: async (_s, line) => {
        if (line.id === "n") {
          return interp({
            callTypeChange: "Education / enrollment",
            raw: "n-stale",
          });
        }
        return interp({
          callTypeChange: "General inquiry / unclassified",
          raw: "nplus1",
        });
      },
      delayApply: { eventId: "n", ms: 80 },
    });

    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "n",
      speaker: "member",
      stability: "final",
      text: "walk me through that longer fill option",
    });
    await copilot.processTranscriptEvent(session, "http://127.0.0.1:9", {
      id: "nplus1",
      speaker: "member",
      stability: "final",
      text: "anyway, just a general question",
    });
    await new Promise((r) => setTimeout(r, 150));

    expect(session.lastInterpretation?.eventId).toBe("nplus1");
    expect(session.callType).toBe("General inquiry / unclassified");
    const log = readFileSync(
      join(process.cwd(), "runs", `${session.sessionId}.jsonl`),
      "utf8",
    );
    expect(log).toMatch(/"kind":"luna_stale_discard"/);
    expect(log).toMatch(/"eventId":"n"/);
  });
});
