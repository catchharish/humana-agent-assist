import { describe, expect, it } from "vitest";
import { originUp, measureUtterance } from "./driver";

const live = await originUp();
const run = process.env.RUN_PATH === "1";

describe.skipIf(!live || !run)("code vs luna path timings", () => {
  it("e-90day scripted uses code_rule", async () => {
    const r = await measureUtterance({
      scenarioId: "t01_m2a",
      replaceId: "e-90day",
      text: "How does the 90-day option work?",
      waitNeed: "service_education",
    });
    const path = r.paths.find((p) => p.need === "service_education")?.path;
    expect(path).toBe("code_rule");
    console.log("path_e90_scripted", { paintMs: r.paintMs, path });
  }, 180_000);

  it("e-90day paraphrase uses luna", async () => {
    const r = await measureUtterance({
      scenarioId: "t01_m2a",
      replaceId: "e-90day",
      text: "Could you go over that longer fill option you brought up?",
      waitNeed: "service_education",
    });
    const path = r.paths.find((p) => p.need === "service_education")?.path;
    expect(path).toBe("luna");
    console.log("path_e90_paraphrase_luna", { paintMs: r.paintMs, path });
  }, 180_000);

  it("e-yes-compare scripted uses code_rule", async () => {
    const r = await measureUtterance({
      scenarioId: "t01_m2a",
      replaceId: "e-yes-compare",
      text: "Yes, please compare both.",
      waitQuotes: true,
    });
    const path = r.paths.find((p) => p.need === "prospective_comparison")?.path;
    expect(path).toBe("code_rule");
    console.log("path_compare_scripted", { paintMs: r.paintMs, path });
  }, 180_000);

  it("e-yes-compare paraphrase uses luna", async () => {
    const r = await measureUtterance({
      scenarioId: "t01_m2a",
      replaceId: "e-yes-compare",
      text: "Yes I want you to compare both pharmacies.",
      waitQuotes: true,
    });
    const path = r.paths.find((p) => p.need === "prospective_comparison")?.path;
    expect(path).toBe("luna");
    console.log("path_compare_paraphrase_luna", { paintMs: r.paintMs, path });
  }, 180_000);
});
