import { describe, expect, it } from "vitest";
import { preferNeedQueryText } from "@/lib/parkedNeed";

describe("preferNeedQueryText", () => {
  it("keeps the first clear ask over an Actually-first interrupt", () => {
    const first = "I put in my atorvastatin refill request. Can you help me check it?";
    const interrupt =
      "Actually first—can you check my refill is ready today?";
    expect(preferNeedQueryText(first, interrupt)).toBe(first);
  });

  it("takes a real question when the prior text had none", () => {
    expect(
      preferNeedQueryText("checking", "Can you check my refill?"),
    ).toBe("Can you check my refill?");
  });
});
