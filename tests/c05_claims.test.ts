import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

type Sample = {
  id: string;
  expectAccept: boolean;
  text: string;
};

function reviewClaims(text: string): { accept: boolean; reasons: string[] } {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  const has8 = /\$?\s*8\b/.test(text);
  const has27 = /\$?\s*27\b/.test(text);
  const lake = /lakeview/i.test(text);
  const oak = /oak street/i.test(text);
  if (lower.includes("plan changed") || lower.includes("the plan changed")) {
    reasons.push("invented_plan_change");
  }
  if (/approved/.test(lower) && /jardiance|coverage/.test(lower)) {
    reasons.push("false_coverage_approval");
  }
  if (/you must enroll|required to enroll|have to enroll/.test(lower)) {
    reasons.push("coercive_enrollment");
  }
  if (/cause is (that )?lakeview changed/i.test(text)) {
    reasons.push("invented_historical_cause");
  }
  const amountsOk = has8 && has27 && lake && oak;
  if (!amountsOk && /historical|\$8|\$27/.test(text)) {
    reasons.push("amount_entity_incomplete");
  }
  return { accept: reasons.length === 0, reasons };
}

describe("C05 claims / evaluator controls", () => {
  const samples = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests/goldens/c05_samples.json"),
      "utf8",
    ),
  ) as Sample[];

  it("scores original and edited draft samples without treating rescue as generation", () => {
    for (const sample of samples) {
      const result = reviewClaims(sample.text);
      expect(result.accept, sample.id + " " + result.reasons.join(",")).toBe(
        sample.expectAccept,
      );
    }
  });
});
