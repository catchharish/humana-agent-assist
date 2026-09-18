import { describe, expect, it } from "vitest";
import { originUp, runScenario } from "./driver";

const live = await originUp();
const runT01 = process.env.RUN_T01 === "1";

describe.skipIf(!live || !runT01)("T01 automated main (fresh model calls)", () => {
  it("completes t01_m2a with human actions from session evidence", async () => {
    const s = await runScenario({ scenarioId: "t01_m2a", compressMs: 30 });
    expect(s.greeting).toBe("exact_timely");
    expect(s.pricing).toBe("late_finding");
    expect(s.enrollment.scopeOk).toBe(true);
    expect(s.coverage?.status).toMatch(/pending/i);
    expect(s.transfer.connectionStatus).toMatch(/connected/i);
    expect(s.disposition.confirmed).toBe("TRANSFERRED_COVERAGE_REVIEW");
    expect(s.wrapDraft.length).toBeGreaterThan(80);
    expect(s.wrapDraft).toMatch(/Connection result/i);
    expect(s.handoffDraft.length).toBeGreaterThan(40);
    expect(s.needs.some((n) => n.kind === "historical_price" && n.guidance === "deferred_valid")).toBe(true);
    expect(s.diagnostics.router.some((r) => r.recheck)).toBe(true);
  }, 900_000);
});
