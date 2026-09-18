import { describe, expect, it } from "vitest";
import { isPrefixOfReading, stitchedReading } from "@/lib/exactness";

const PRICING =
  "Any price estimate we discuss is based on the information available today and may change when your prescription is filled.";

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
