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
  it("marks price-cause without a plan-rule source as partial", () => {
    const r = supportCheck({
      question: "Why was my metformin $8 last month and $27 yesterday?",
      answer:
        "Oak Street was preferred so you paid $8 and Lakeview was standard so you paid $27.",
      toolsUsed: ["getClaims", "getPharmacyNetwork"],
      snapshotHasPlanRule: false,
      sources: ["System record · claims · simulated"],
    });
    expect(r.partial).toBe(true);
    expect(r.body).toBe("Charges confirmed; rule not confirmed.");
  });

  it("accepts a plan-rule tool as support", () => {
    const r = supportCheck({
      question: "Why was my metformin $8 last month and $27 yesterday?",
      answer: "Preferred vs standard under the plan rule.",
      toolsUsed: ["getClaims", "getCostShare"],
      snapshotHasPlanRule: false,
      sources: ["Governed guidance · scripting · simulated"],
    });
    expect(r.partial).toBe(false);
  });
});

describe("answer loop stale apply", () => {
  it("drops a late answer after a new question generation", () => {
    const s = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    const g1 = beginAnswerLoop(s, "why $8 and $27");
    expect(shouldApplyAnswerLoop(s, g1)).toBe(true);
    beginAnswerLoop(s, "is my refill ready");
    expect(shouldApplyAnswerLoop(s, g1)).toBe(false);
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
