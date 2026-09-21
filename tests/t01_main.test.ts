import { describe, expect, it } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { originUp, runScenario } from "./driver";

const live = await originUp();
const runT01 = process.env.RUN_T01 === "1";

describe.skipIf(!live || !runT01)("T01 automated main (fresh model calls)", () => {
  it("completes t01_m2a with human actions from session evidence", async () => {
    const s = await runScenario({ scenarioId: "t01_m2a", compressMs: 30 });
    const rows = (s.lookupProgress ?? []).map((p) => {
      const firstStepMs = p.firstStepAt != null ? p.firstStepAt - p.startedAt : null;
      const firstFactMs = p.firstFactAt != null ? p.firstFactAt - p.startedAt : null;
      const fullAnswerMs = p.answeredAt != null ? p.answeredAt - p.startedAt : null;
      return {
        question: p.question,
        firstStepMs,
        firstFactMs,
        fullAnswerMs,
        advocateWaitMs: p.advocateWaitMs,
        miss1s: firstStepMs == null || firstStepMs > 1000,
        miss2s: firstFactMs == null || firstFactMs > 2000,
        miss5s: fullAnswerMs == null || fullAnswerMs > 5000,
        miss8s: fullAnswerMs == null || fullAnswerMs > 8000,
      };
    });
    writeFileSync(
      join(process.cwd(), "runs", `${s.sessionId}.lookup.md`),
      [
        `# Main-call lookup timings (${s.sessionId})`,
        "",
        "Misses against 1/2/5/8 stay misses. Advocate wait is machine time, not a presenter pause.",
        "",
        ...rows.flatMap((r) => [
          `## ${r.question}`,
          `- first step: ${r.firstStepMs ?? "—"} ms${r.miss1s ? " (miss 1s)" : ""}`,
          `- first fact: ${r.firstFactMs ?? "—"} ms${r.miss2s ? " (miss 2s)" : ""}`,
          `- full answer: ${r.fullAnswerMs ?? "—"} ms${r.miss5s ? " (miss 5s)" : ""}${r.miss8s ? " (miss 8s)" : ""}`,
          `- advocate wait: ${r.advocateWaitMs ?? "—"} ms`,
          "",
        ]),
      ].join("\n"),
    );
    expect(s.greeting).toBe("exact_timely");
    expect(s.pricing).toBe("late_finding");
    expect(s.enrollment.scopeOk).toBe(true);
    expect(s.coverage?.status).toMatch(/pending/i);
    expect(s.transfer.connectionStatus).toMatch(/connected/i);
    expect(s.disposition.confirmed).toBe("TRANSFERRED_COVERAGE_REVIEW");
    expect(s.disposition.documentId).toBe("DEMO-DISPOSITIONS-v1");
    expect(s.disposition.reasons.some((reason) => reason.confirmed)).toBe(true);
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
