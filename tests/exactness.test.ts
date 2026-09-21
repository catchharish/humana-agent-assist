import { describe, expect, it } from "vitest";
import {
  alignedWordDiff,
  isPrefixOfReading,
  stitchedReading,
  wordDiff,
} from "@/lib/exactness";

const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";

describe("alignedWordDiff", () => {
  it("marks the T01 pricing paraphrase in place instead of a bag dump", () => {
    const d = alignedWordDiff("These prices might change.", PRICING);
    expect(d.heardMarks.map((m) => m.status)).toEqual([
      "extra",
      "extra",
      "extra",
      "same",
    ]);
    expect(d.heardMarks.at(-1)?.word).toBe("change");
    expect(
      d.requiredMarks.some((m) => m.word === "change" && m.status === "same"),
    ).toBe(true);
    expect(d.leftOutPhrases.length).toBe(2);
    expect(d.leftOutPhrases[0]).toMatch(/^any price estimate/i);
    expect(d.leftOutPhrases[1]).toMatch(/^when your prescription/i);
    expect(d.missingFromHeard).not.toContain("change");
    expect(d.extraInHeard).toEqual(["these", "prices", "might"]);
  });

  it("aligns a near-miss closing gap", () => {
    const d = wordDiff(
      "Your decision today has no — membership",
      "Your decision today has no impact on your plan membership.",
    );
    expect(d.missingFromHeard).toEqual(["impact", "on", "your", "plan"]);
    expect(d.extraInHeard).toEqual([]);
  });

  it("flags greeting recoded vs recorded as a single swap", () => {
    const d = alignedWordDiff(
      "Thank you for calling Humana. This call is being recoded.",
      "Thank you for calling Humana. This call is being recorded.",
    );
    expect(d.missingFromHeard).toEqual(["recorded"]);
    expect(d.extraInHeard).toEqual(["recoded"]);
    expect(d.leftOutPhrases).toEqual(["recorded"]);
  });
});

describe("stitchedReading §12.4", () => {
  it("joins prefix segments of one required reading", () => {
    const transcript = [
      {
        id: "a",
        speaker: "advocate",
        stability: "final",
        text: "Any price estimate we discuss is based on the information available today",
      },
      {
        id: "b",
        speaker: "advocate",
        stability: "final",
        text: "and may change when your prescription is filled.",
      },
    ];
    expect(
      stitchedReading(transcript, transcript[1], PRICING).toLowerCase(),
    ).toContain("may change when your prescription is filled");
    expect(isPrefixOfReading(transcript[0].text, PRICING)).toBe(true);
  });

  it("stops at another speaker", () => {
    const transcript = [
      {
        id: "a",
        speaker: "advocate",
        stability: "final",
        text: "Any price estimate we discuss is based on the information available today",
      },
      {
        id: "m",
        speaker: "member",
        stability: "final",
        text: "ok",
      },
      {
        id: "b",
        speaker: "advocate",
        stability: "final",
        text: "and may change when your prescription is filled.",
      },
    ];
    expect(stitchedReading(transcript, transcript[2], PRICING)).toBe(
      transcript[2].text,
    );
  });
});
