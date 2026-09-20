import { describe, expect, it } from "vitest";
import { originUp, runScenario } from "./driver";

const live = await originUp();

describe.skipIf(!live)("§19.3 replays (live app)", () => {
  it("T02A clean servicing / silence", async () => {
    const s = await runScenario({ scenarioId: "t02a" });
    expect(s.greeting).toBe("exact_timely");
    expect(s.member).not.toBeNull();
    expect(s.nowCard.title.toLowerCase()).not.toMatch(/weather|small talk/);
    expect(s.needs.some((n) => n.kind === "refill_status")).toBe(true);
    expect(s.needs.some((n) => n.kind === "prospective_comparison")).toBe(false);
    expect(s.enrollment.submitted).toBe(false);
    expect(s.pricing).toBe("not_applicable");
    expect(s.recommendation?.status === "pending").toBe(false);
    expect(s.nowCard.body).not.toMatch(/\$8|\$27/);
    expect(s.disposition.recommended).toBe("COMPLETED_SERVICING");
    expect(s.disposition.confirmed).toBe("COMPLETED_SERVICING");
  }, 180_000);

  it("T03A member-led 90-day", async () => {
    const s = await runScenario({ scenarioId: "t03a" });
    expect(s.callType).toBe("Education / enrollment");
    expect(s.needs.some((n) => n.kind === "service_education")).toBe(true);
    expect(s.needs.some((n) => n.kind === "refill_status")).toBe(false);
    expect(s.enrollment.submitted).toBe(false);
    expect(s.pricing).toBe("not_applicable");
    expect(s.greeting).toBe("exact_timely");
    expect(s.closing).toBe("exact_timely");
  }, 180_000);

  it("T03B firm refusal", async () => {
    const s = await runScenario({ scenarioId: "t03b" });
    expect(s.optionalWorkSuppressed).toBe(true);
    expect(s.recommendation).toBeNull();
    expect(s.enrollment.submitted).toBe(false);
    expect(s.quotes.length).toBe(0);
    expect(s.closing).toBe("exact_timely");
  }, 180_000);

  it("T04B changed pharmacy / invalidation", async () => {
    const s = await runScenario({ scenarioId: "t04b", overlay: "T04B" });
    const lake = s.quotes.find((q) => q.quoteId === "DEMO-Q-MET-L");
    const oak = s.quotes.find((q) => q.quoteId === "DEMO-Q-MET-O");
    expect(lake).toBeTruthy();
    expect(lake?.validityStatus).toBe("invalidated");
    expect(lake?.pharmacyName).toMatch(/Lakeview/);
    expect(lake?.estimatedMemberCost.value).toBe("60.00");
    expect(oak?.validityStatus).toBe("valid");
    expect(oak?.estimatedMemberCost.value).toBe("24.00");
    expect(oak?.pharmacyName).toMatch(/Oak Street/);
    expect(s.nowCard.title).toMatch(/Pricing statement due now|Prospective comparison/i);
    expect(s.nowCard.body).not.toMatch(/\$24/);
  }, 180_000);

  it("T06A omit DEMO-NET0818", async () => {
    const s = await runScenario({ scenarioId: "t06a", overlay: "T06A" });
    const hist = s.needs.find((n) => n.kind === "historical_price");
    const seen = `${s.nowCard.body}\n${hist?.answer?.body ?? ""}`;
    expect(seen).toMatch(/\$8|8/);
    expect(seen).toMatch(/\$27|27/);
    expect(s.nowCard.body).toMatch(/not confirmed/i);
    expect(s.nowCard.body).not.toMatch(/because|classified as/i);
    expect(s.nowCard.body).not.toMatch(/preferred versus standard/i);
    expect(JSON.stringify(s.nowCard.earlyFacts ?? [])).not.toMatch(
      /preferred retail/i,
    );
    const rec = `${s.recommendation?.body ?? ""} ${JSON.stringify(s.recommendation?.facts ?? [])} ${JSON.stringify(s.recommendation?.reasons ?? [])}`;
    expect(rec).not.toMatch(/preferred(_retail|\s+retail)|standard(_retail|\s+retail)/i);
  }, 180_000);

  it("T08B changed scope and withdrawal", async () => {
    const s = await runScenario({ scenarioId: "t08b", overlay: "T08B" });
    expect(s.enrollment.withdrawn).toBe(true);
    expect(s.enrollment.submitted).toBe(false);
    expect(s.enrollment.confirmed).toBe(false);
    expect(s.enrollment.medications).toContain("atorvastatin");
    expect(s.enrollment.medications).toContain("metformin");
    expect(s.enrollment.readback).toMatch(/metformin/i);
    expect(s.enrollment.readback).toMatch(/atorvastatin/i);
    expect(s.closing).toBe("exact_timely");
  }, 180_000);
});
