import { describe, expect, it } from "vitest";
import { supportCheck } from "@/lib/supportCheck";
import {
  beginAnswerLoop,
  createSession,
  shouldApplyAnswerLoop,
  shouldPaintAnswerOntoNow,
  upsertNeed,
} from "@/lib/session";
import { parkedNeedKindForUtterance } from "@/lib/parkedNeed";
import { questionCouldChange } from "@/lib/answerLoop";
import { resumeParkedNeed } from "@/lib/copilot";
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
    expect(hist?.status).toBe("resolved");
    expect(hist?.guidance).toBe("deferred_valid");
    expect(hist?.answer?.body).toBe("park me");
    // Prior answer stays on Now until Terra paints the next card.
    expect(s.nowCard.body).toBe("park me");
    expect(s.nowCardNeedKind).toBe("historical_price");
    expect(s.answerLoopAnchor?.needKind).toBe("refill_status");
  });

  it("paints a late answer while Now is still looking up that question", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    upsertNeed(s, "historical_price", {
      status: "active",
      queryText: "why $8 and $27",
      sourceUtteranceId: "e-hist",
    });
    const g1 = beginAnswerLoop(s, "why $8 and $27", "historical_price", "e-hist");
    beginAnswerLoop(s, "is my refill ready", "refill_status", "e-rx");
    s.nowCard = {
      title: "Working on it",
      body: "why $8 and $27",
      sourceLabel: "Copilot",
    };
    s.nowCardNeedKind = "historical_price";
    s.nowCardOrigin = "answer";
    expect(
      shouldPaintAnswerOntoNow(s, {
        generation: g1,
        needKind: "historical_price",
        question: "why $8 and $27",
      }),
    ).toBe(true);
  });

  it("does not paint a late answer over a different question's lookup", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    const g1 = beginAnswerLoop(s, "why $8 and $27", "historical_price");
    beginAnswerLoop(s, "is my refill ready", "refill_status");
    // Prior greeting/answer stays on Now until Terra paints; simulate a live
    // refill lookup already claimed on Now.
    s.nowCard = {
      title: "is my refill ready",
      body: "",
      sourceLabel: "Copilot",
      liveSteps: ["Searching knowledge…"],
    };
    s.nowCardOrigin = "answer";
    s.nowCardNeedKind = "refill_status";
    expect(
      shouldPaintAnswerOntoNow(s, {
        generation: g1,
        needKind: "historical_price",
        question: "why $8 and $27",
      }),
    ).toBe(false);
  });

  it("does not park a Working on it placeholder as the answer", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    upsertNeed(s, "historical_price", {
      status: "active",
      queryText: "why $8 and $27",
      sourceUtteranceId: "e-hist",
    });
    beginAnswerLoop(s, "why $8 and $27", "historical_price", "e-hist");
    beginAnswerLoop(s, "is my refill ready", "refill_status", "e-rx");
    const hist = s.needs.find((n) => n.kind === "historical_price");
    expect(hist?.answer?.title).not.toBe("Working on it");
    expect(hist?.answer?.body).not.toBe("why $8 and $27");
  });

  it("puts a parked answer back on Now instead of Working on it", async () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    upsertNeed(s, "historical_price", {
      status: "deferred",
      guidance: "deferred_valid",
      queryText: "Why was my metformin eight dollars last month and twenty-seven dollars yesterday?",
      sourceUtteranceId: "e-hist",
    });
    s.needs[0].answer = {
      title: "The two fills used different pharmacies",
      body: "He paid $8.00 at Oak Street and $27.00 at Lakeview.",
      sourceLabel: "Claims",
    };
    beginAnswerLoop(s, "is my refill ready", "refill_status");
    await resumeParkedNeed(s, "http://127.0.0.1:9", "historical_price");
    expect(s.nowCard.body).toMatch(/\$8\.00/);
    expect(s.nowCard.title).not.toBe("Working on it");
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

describe("parked need return cue", () => {
  it("maps So, the metformin? to a deferred historical need", () => {
    const kind = parkedNeedKindForUtterance(
      [
        {
          kind: "historical_price",
          status: "deferred",
          guidance: "deferred_valid",
          flowStep: "parked",
          queryText: "Why was my metformin eight dollars last month?",
        },
      ],
      "So, the metformin?",
      ["metformin"],
    );
    expect(kind).toBe("historical_price");
  });

  it("maps the return cue even when the parked answer is resolved, not deferred", () => {
    const kind = parkedNeedKindForUtterance(
      [
        {
          kind: "historical_price",
          status: "resolved",
          guidance: "ready",
          flowStep: "answered",
          queryText: "Why was my metformin eight dollars last month?",
          answer: {
            title: "Two pharmacies",
            body: "He paid $8.00 and $27.00.",
            sourceLabel: "Claims",
          },
        },
      ],
      "So, the metformin?",
      ["metformin"],
    );
    expect(kind).toBe("historical_price");
  });

  it("maps the return cue while historical is still preparing", () => {
    const kind = parkedNeedKindForUtterance(
      [
        {
          kind: "historical_price",
          status: "active",
          guidance: "preparing",
          flowStep: "lookup",
          queryText: "Why was my metformin eight dollars last month?",
        },
      ],
      "So, the metformin?",
      ["metformin"],
    );
    expect(kind).toBe("historical_price");
  });

  it("maps the first long metformin question to historical", () => {
    const kind = parkedNeedKindForUtterance(
      [
        {
          kind: "historical_price",
          status: "resolved",
          guidance: "deferred_valid",
          flowStep: "answered",
          queryText:
            "Why was my metformin eight dollars last month and twenty-seven dollars yesterday?",
          answer: {
            title: "Two pharmacies",
            body: "He paid $8.00 and $27.00.",
            sourceLabel: "Claims",
          },
        },
      ],
      "Why was my metformin eight dollars last month and twenty-seven dollars yesterday?",
      ["metformin"],
    );
    expect(kind).toBe("historical_price");
  });

  it("maps a refill-readiness interrupt to the refill need", () => {
    const kind = parkedNeedKindForUtterance(
      [
        {
          kind: "refill_status",
          status: "resolved",
          guidance: "deferred_valid",
          flowStep: "answered",
          queryText: "I put in my atorvastatin refill request. Can you help me check it?",
          answer: {
            title: "Ready",
            body: "The atorvastatin is ready at Lakeview.",
            sourceLabel: "Pharmacy system",
          },
        },
      ],
      "Actually first—can you check my refill is ready today?",
      ["atorvastatin"],
    );
    expect(kind).toBe("refill_status");
  });
});
