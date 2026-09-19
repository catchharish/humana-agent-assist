import { describe, expect, it } from "vitest";
import { supportCheck } from "@/lib/supportCheck";
import { filterKnowledgeByPlan } from "@/lib/answerLoop";
import { originUp } from "./driver";
import type { SessionState } from "@/lib/types";

describe("plan applicability is session-relative", () => {
  it("keeps OTHER policy for DEMO-OTHER-PLAN and rejects MAPD cost policy", () => {
    const cands = [
      { id: "DEMO-POLICY-COST-v1", planId: "DEMO-MAPD-001" },
      { id: "DEMO-POLICY-OTHER-v1", planId: "DEMO-OTHER-PLAN" },
      { id: "DEMO-FAQ-PHARMACY-v1", planId: null },
    ];
    const other = filterKnowledgeByPlan(cands, "DEMO-OTHER-PLAN");
    expect(other.kept.map((c) => c.id)).toEqual([
      "DEMO-POLICY-OTHER-v1",
      "DEMO-FAQ-PHARMACY-v1",
    ]);
    expect(other.rejected).toEqual([
      { id: "DEMO-POLICY-COST-v1", reason: "rejected: wrong plan" },
    ]);
    const mapd = filterKnowledgeByPlan(cands, "DEMO-MAPD-001");
    expect(mapd.kept.map((c) => c.id)).toEqual([
      "DEMO-POLICY-COST-v1",
      "DEMO-FAQ-PHARMACY-v1",
    ]);
    expect(mapd.rejected[0]?.id).toBe("DEMO-POLICY-OTHER-v1");
  });

  it("does not rewrite an M004 price answer that cites the other-plan rule", () => {
    const r = supportCheck({
      question: "Why was my metformin $12? Use my plan's cost rule, not MAPD-001.",
      answer:
        "Your metformin 30-day retail fill was $12.00 under other_plan_retail on DEMO-OTHER-PLAN.",
      toolsUsed: [],
      snapshotHasPlanRule: true,
      sources: [
        "Governed guidance · scripting · simulated (DEMO-POLICY-OTHER-v1)",
      ],
    });
    expect(r.partial).toBe(false);
    expect(r.body).toMatch(/12/);
  });
});

const live = await originUp();
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";

async function ask(memberId: string, text: string) {
  const start = await fetch(`${ORIGIN}/api/session/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "nba_member", memberId, injectedDelayMs: 0 }),
  });
  const started = (await start.json()) as { session: SessionState };
  const sid = started.session.sessionId;
  await fetch(`${ORIGIN}/api/session/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: sid,
      event: { id: "e-auth", type: "system", name: "authorization" },
    }),
  });
  await fetch(`${ORIGIN}/api/session/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: sid,
      event: {
        id: "e-q",
        type: "transcript",
        speaker: "member",
        stability: "final",
        text,
      },
    }),
  });
  const end = Date.now() + 70_000;
  let session = started.session;
  while (Date.now() < end) {
    const r = await fetch(`${ORIGIN}/api/session/state?sessionId=${sid}`);
    if (r.ok) {
      session = ((await r.json()) as { session?: SessionState }).session ?? session;
      const answered =
        /12|metformin|Charges confirmed|Partial/i.test(session.nowCard.body) &&
        !/Protected fields were withheld/i.test(session.nowCard.body);
      if (answered) break;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  return session;
}

describe.skipIf(!live)("M004 live other-plan policy", () => {
  it("answers $12 from DEMO-POLICY-OTHER and does not use Harry amounts", async () => {
    const s = await ask(
      "DEMO-M004",
      "Why was my metformin $12? Use my plan's cost rule, not MAPD-001.",
    );
    expect(s.nowCard.body).toMatch(/12/);
    expect(s.nowCard.body).not.toMatch(/Charges confirmed; rule not confirmed/);
    expect(s.nowCard.body).not.toMatch(/\$8|\$27/);
    const rejected = s.diagnostics.router.flatMap((r) => r.rejected);
    expect(rejected.some((x) => x.id === "DEMO-POLICY-COST-v1")).toBe(true);
    expect(rejected.some((x) => x.id === "DEMO-POLICY-OTHER-v1")).toBe(false);
  }, 90_000);
});
