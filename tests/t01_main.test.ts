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
    expect(s.wrapDraft).toMatch(/DEMO-ENR001/i);
    expect(s.wrapDraft).toMatch(/metformin/i);
    expect(s.wrapDraft).toMatch(/ready/i);
    expect(s.wrapDraft).toMatch(/DEMO-CVR001/i);
    expect(s.handoffDraft.length).toBeGreaterThan(40);
    const readyGate = s.diagnostics.pauseSnapshots.find((p) =>
      /refill is primary; historical should be deferred/i.test(p.label),
    );
    expect(readyGate?.historicalStatus).toBe("deferred");
    expect(["preparing", "deferred_valid"]).toContain(
      readyGate?.historicalGuidance,
    );
    expect(s.needs.some((n) => n.kind === "historical_price" && n.status === "resolved")).toBe(true);
    expect(s.diagnostics.router.some((r) => r.recheck)).toBe(true);
  }, 900_000);
});
