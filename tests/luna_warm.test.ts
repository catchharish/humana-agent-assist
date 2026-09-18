import { describe, expect, it } from "vitest";
import { interpretUtterance } from "@/lib/interpret";
import { createSession } from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

const run = process.env.RUN_LUNA_WARM === "1";

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

describe.skipIf(!run)("luna compact JSON warm latency", () => {
  it("10 sequential interpret calls after one discarded warm", async () => {
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.callType = "Refill";
    session.currentNeed = "opening";
    await interpretUtterance(session, {
      speaker: "member",
      stability: "final",
      text: "warmup compact schema",
    });
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await interpretUtterance(session, {
        speaker: "member",
        stability: i % 2 === 0 ? "partial" : "final",
        text: "Has the bottle I requested earlier shown up in the system?",
      });
      expect(r.ok).toBe(true);
      samples.push(r.ms);
    }
    const med = median(samples);
    const max = Math.max(...samples);
    console.log("luna_warm_10", { samples, median: med, max });
    expect(samples).toHaveLength(10);
  }, 180_000);
});
