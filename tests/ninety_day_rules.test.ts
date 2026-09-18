import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  isNinetyDayQuestion,
  type UtteranceRules,
} from "@/lib/utteranceRules";

const rules = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "fixtures/utterance_rules.json"),
    "utf8",
  ),
) as UtteranceRules;

const STREAM_LINES = new Set([
  "How does the 90-day option work?",
  "What is the 90-day metformin estimate at Lakeview?",
]);

describe("90-day need class (not scripted sentences)", () => {
  const fires = [
    "Can you walk me through the ninety-day mail option?",
    "What's this three-month delivery thing about?",
    "Could you explain how 90-day supply works for me?",
    "Is the 90 day option something I should consider?",
    "How would a ninety day fill actually work?",
    "Tell me about the 90-day program, would you?",
  ];
  const misses = [
    "my 90-day supply ran out",
    "I already get 90 days at Oak Street",
    "The 90-day bottle is still full",
    "They put me on ninety-day fills last year",
  ];

  it("fires on paraphrases that are not stream lines", () => {
    expect(fires).toHaveLength(6);
    for (const text of fires) {
      expect(STREAM_LINES.has(text), text).toBe(false);
      expect(isNinetyDayQuestion(rules, text), text).toBe(true);
    }
  });

  it("does not fire on near-misses", () => {
    expect(misses).toHaveLength(4);
    for (const text of misses) {
      expect(STREAM_LINES.has(text), text).toBe(false);
      expect(isNinetyDayQuestion(rules, text), text).toBe(false);
    }
  });

  it("does not treat a named-pharmacy estimate question as 90-day education", () => {
    expect(
      isNinetyDayQuestion(
        rules,
        "What's the 90-day lisinopril estimate at my corner store?",
      ),
    ).toBe(false);
  });
});
