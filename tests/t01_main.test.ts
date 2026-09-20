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
    expect(readyGate).toBeTruthy();
    expect(readyGate?.nowBody ?? "").not.toMatch(/\$8/);
    expect(readyGate?.nowBody ?? "").not.toMatch(/\$27/);
    expect(
      readyGate?.historicalStatus === "deferred" ||
        readyGate?.historicalGuidance === "deferred_valid",
    ).toBe(true);
    const hist = s.needs.find((n) => n.kind === "historical_price");
    const refill = s.needs.find((n) => n.kind === "refill_status");
    expect(hist?.answer?.body ?? "").toMatch(/\$?8/);
    expect(hist?.answer?.body ?? "").toMatch(/\$?27/);
    expect(hist?.answer?.body ?? "").not.toMatch(/is active for/i);
    expect(refill?.answer?.body ?? "").toMatch(/ready/i);
    expect(s.actionResults.some((a) => a.kind === "enrollment_submit")).toBe(
      true,
    );
    expect(
      s.diagnostics.rechecks.length > 0 ||
        s.diagnostics.router.some((r) => r.recheck),
    ).toBe(true);
  }, 900_000);
});
