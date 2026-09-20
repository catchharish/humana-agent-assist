import { describe, expect, it } from "vitest";
import { supportCheck } from "@/lib/supportCheck";
import {
  beginAnswerLoop,
  createSession,
  shouldApplyAnswerLoop,
} from "@/lib/session";
import { questionCouldChange } from "@/lib/answerLoop";
import type { DisclosureRequirement } from "@/lib/types";

describe("support check", () => {
  it("marks a preferred-retail cause without a dated classification as not confirmed", () => {
    const r = supportCheck({
      question: "Why was my metformin $8 last month and $27 yesterday?",
      answer:
        "Oak Street Pharmacy was preferred so you paid $8.00 and Lakeview Pharmacy was standard so you paid $27.00.",
      toolsUsed: ["getClaims", "getPharmacyNetwork"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
      retrieved: [
        {
          id: "DEMO-C0818",
          kind: "record",
          sourceTag: "Claims",
          text: JSON.stringify({
            claimId: "DEMO-C0818",
            memberPaidAmount: "8.00",
            pharmacy: "Oak Street Pharmacy",
          }),
        },
      ],
    });
    expect(r.partial).toBe(true);
    expect(r.body).toMatch(/not confirmed/i);
  });

  it("confirms a network-tier sentence from a dated classification record", () => {
    const r = supportCheck({
      question: "Why was my metformin $8 last month and $27 yesterday?",
      answer: "Oak Street Pharmacy was preferred retail on 2026-08-18.",
      statements: [
        {
          text: "Oak Street Pharmacy was preferred retail on 2026-08-18.",
          sourceId: "DEMO-NET0818",
        },
      ],
      toolsUsed: ["getPharmacyNetwork"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-NET0818"],
      retrieved: [
        {
          id: "DEMO-NET0818",
          kind: "classification",
          sourceTag: "Plan rules",
          text: JSON.stringify({
            classificationId: "DEMO-NET0818",
            pharmacyName: "Oak Street Pharmacy",
            asOfDate: "2026-08-18",
            networkTier: "preferred_retail",
          }),
        },
      ],
    });
    expect(r.partial).toBe(false);
    expect(r.statements[0]?.confirmed).toBe(true);
  });
});

describe("answer loop stale apply", () => {
  it("drops a late answer after a new question generation", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    const g1 = beginAnswerLoop(s, "why $8 and $27", "historical_price");
    expect(shouldApplyAnswerLoop(s, g1)).toBe(true);
    s.nowCard = {
      title: "Answer",
      body: "park me",
      sourceLabel: "Claims",
    };
    s.nowCardNeedKind = "historical_price";
    s.nowCardOrigin = "answer";
    s.currentNeed = "refill status";
    beginAnswerLoop(s, "is my refill ready", "refill_status");
    expect(shouldApplyAnswerLoop(s, g1)).toBe(false);
    const hist = s.needs.find((n) => n.kind === "historical_price");
    expect(hist?.status).toBe("deferred");
    expect(hist?.guidance).toBe("deferred_valid");
    expect(hist?.answer?.body).toBe("park me");
    expect(s.nowCard.body).toBe("is my refill ready");
  });

  it("drops a late answer after enrollment consent changes", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    const g1 = beginAnswerLoop(s, "why $8 and $27");
    s.consent.enrollment = "absolute_yes";
    expect(shouldApplyAnswerLoop(s, g1)).toBe(false);
  });

  it("drops a late answer after enrollment scope changes", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    s.enrollment.medications = ["metformin"];
    const g1 = beginAnswerLoop(s, "why $8 and $27");
    s.enrollment.medications = ["metformin", "atorvastatin"];
    expect(shouldApplyAnswerLoop(s, g1)).toBe(false);
  });
});

describe("early start question change", () => {
  it("keeps a punctuation-only final", () => {
    expect(
      questionCouldChange(
        "Why was my metformin $8 last month and $27 yesterday",
        "Why was my metformin $8 last month and $27 yesterday?",
      ),
    ).toBe(false);
  });

  it("restarts when a coverage clause appears", () => {
    expect(
      questionCouldChange(
        "Confirm whether my atorvastatin refill is ready",
        "Confirm whether my atorvastatin refill is ready and check the coverage-review case for Jardiance",
      ),
    ).toBe(true);
  });
});

describe("preload filter", () => {
  it("keeps only allowed session tools and never getQuotes", async () => {
    const { filterPreloadNames } = await import("@/lib/answerLoop");
    expect(
      filterPreloadNames(
        ["getClaims", "getQuotes", "hackOtherMember", "searchKnowledge"],
        false,
      ),
    ).toEqual(["getClaims", "searchKnowledge"]);
  });

  it("caps at four names", async () => {
    const { filterPreloadNames } = await import("@/lib/answerLoop");
    expect(
      filterPreloadNames(
        [
          "getClaims",
          "getPlan",
          "getCostShare",
          "getPrescriptions",
          "getOpenCases",
        ],
        false,
      ),
    ).toHaveLength(4);
  });
});
