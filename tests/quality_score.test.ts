import { describe, expect, it } from "vitest";
import type { LogRecord } from "@/lib/log";
import { scoreQualityRecords } from "@/lib/qualityScore";

/** Shorthand for a required_wording run-log record. */
function rec(
  requirementId: string,
  plainName: string,
  event: "status" | "nudge" | "exact",
  extra: Record<string, unknown> = {},
): LogRecord {
  return {
    t: new Date().toISOString(),
    kind: "required_wording",
    event,
    requirementId,
    plainName,
    checkedBy: "code",
    ...extra,
  };
}

const GREETING = ["DEMO-GREETING-v1", "Greeting"] as const;
const PRICING = ["DEMO-PRICING-v1", "Pricing disclaimer"] as const;
const CLOSING = ["DEMO-CLOSING-v2", "Closing statement"] as const;

describe("after-call Quality Score", () => {
  it("counts a statement only when its rule applied on this call", () => {
    const score = scoreQualityRecords("s1", [
      rec(...GREETING, "status", { to: "due_now", callMs: 0 }),
      rec(...GREETING, "status", { to: "exact_timely", callMs: 900 }),
      rec(...GREETING, "exact", { callMs: 900 }),
      rec(...PRICING, "status", { to: "not_applicable", callMs: 0 }),
      rec(...CLOSING, "status", { to: "not_applicable", callMs: 0 }),
    ]);
    expect(score.counts.required).toBe(1);
    expect(score.counts.on_time).toBe(1);
    expect(score.requirements.find((r) => r.requirementId === PRICING[0])?.applied).toBe(
      false,
    );
  });

  it("separates read-late-and-corrected from never corrected", () => {
    const score = scoreQualityRecords("s2", [
      // Corrected after the deadline: a late reading did happen.
      rec(...PRICING, "status", { to: "due_now", callMs: 1000 }),
      rec(...PRICING, "status", { to: "late_finding", callMs: 4000 }),
      rec(...PRICING, "nudge", { callMs: 4000, sinceEventMs: 310 }),
      rec(...PRICING, "exact", { callMs: 9000 }),
      // Never read at all: late_finding with no exact reading anywhere.
      rec(...GREETING, "status", { to: "due_now", callMs: 0 }),
      rec(...GREETING, "status", { to: "late_finding", callMs: 2000 }),
    ]);
    expect(score.counts.required).toBe(2);
    expect(score.counts.late_corrected).toBe(1);
    expect(score.counts.never_corrected).toBe(1);
    expect(score.counts.on_time).toBe(0);

    const pricing = score.requirements.find((r) => r.requirementId === PRICING[0])!;
    expect(pricing.msToNudge).toBe(310);
    expect(pricing.msToExact).toBe(5000);
  });

  it("keeps an unresolved uncertain reading as could not verify", () => {
    const score = scoreQualityRecords("s3", [
      rec(...CLOSING, "status", { to: "due_now", callMs: 1000 }),
      rec(...CLOSING, "status", { to: "unable_to_verify", callMs: 2000 }),
      rec(...CLOSING, "nudge", { callMs: 2000, sinceEventMs: 120 }),
      // Call end settles it as a compliance miss; the honest words stay the same.
      rec(...CLOSING, "status", { to: "missed_not_recoverable", callMs: 8000 }),
    ]);
    expect(score.counts.could_not_verify).toBe(1);
    expect(score.counts.never_corrected).toBe(0);
  });

  it("counts an uncertain attempt that was later reread as on time", () => {
    const score = scoreQualityRecords("s4", [
      rec(...CLOSING, "status", { to: "due_now", callMs: 1000 }),
      rec(...CLOSING, "status", { to: "unable_to_verify", callMs: 2000 }),
      rec(...CLOSING, "status", { to: "exact_timely", callMs: 5000 }),
      rec(...CLOSING, "exact", { callMs: 5000 }),
    ]);
    expect(score.counts.on_time).toBe(1);
    expect(score.counts.could_not_verify).toBe(0);
  });

  it("records whether the check ran in code or used a model", () => {
    const score = scoreQualityRecords("s5", [
      rec(...PRICING, "status", {
        to: "late_finding",
        callMs: 3000,
        checkedBy: "model",
      }),
      rec(...PRICING, "nudge", {
        callMs: 3000,
        sinceEventMs: 640,
        checkedBy: "model",
      }),
    ]);
    expect(score.misses[0].checkedBy).toBe("model");
  });

  it("puts every applied statement in exactly one bucket, with log lines behind it", () => {
    const score = scoreQualityRecords("s6", [
      rec(...GREETING, "status", { to: "exact_timely", callMs: 800 }),
      rec(...GREETING, "exact", { callMs: 800 }),
      rec(...PRICING, "status", { to: "late_finding", callMs: 3000 }),
      rec(...CLOSING, "status", { to: "missed_not_recoverable", callMs: 9000 }),
    ]);
    const { counts, evidence } = score;
    expect(
      counts.on_time +
        counts.late_corrected +
        counts.never_corrected +
        counts.could_not_verify,
    ).toBe(counts.required);
    expect(evidence.required.length).toBe(4);
    expect(evidence.on_time.length).toBe(2);
    expect(evidence.never_corrected.length).toBe(2);
  });

  it("reports nothing rather than guessing when the log has no obligations", () => {
    const score = scoreQualityRecords("s7", [
      { t: "x", kind: "transcript", eventId: "e1" },
    ]);
    expect(score.counts.required).toBe(0);
    expect(score.misses).toEqual([]);
  });
});
