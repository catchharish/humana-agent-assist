import { describe, expect, it } from "vitest";
import { originUp } from "./driver";
import type { SessionState } from "@/lib/types";

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
        session.nowCard.body &&
        !/Protected fields were withheld/i.test(session.nowCard.body) &&
        session.nowCard.title !== "Opening";
      const hasNba =
        session.recommendation || (session.diagnostics.nba ?? []).length > 0;
      if (answered && hasNba) break;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  return session;
}

describe.skipIf(!live)("answers are not canned", () => {
  it("same question, different members, different facts", async () => {
    const q = "Why did my last metformin fill cost what it did?";
    const harry = await ask("DEMO-M001", q);
    const priya = await ask("DEMO-M004", q);
    expect(harry.nowCard.body).not.toBe(priya.nowCard.body);
    expect(`${harry.nowCard.body}`).not.toMatch(/\bbeat\b|\bstep \d/i);
    expect(`${priya.nowCard.body}`).not.toMatch(/\bbeat\b|\bstep \d/i);
    expect(priya.nowCard.body).not.toMatch(/\$8|\$27/);
  }, 180_000);

  it("same member, different questions, different answers", async () => {
    const hist = await ask(
      "DEMO-M001",
      "Why was my metformin $8 last month and $27 yesterday?",
    );
    const refill = await ask(
      "DEMO-M001",
      "Is my atorvastatin refill ready for pickup right now?",
    );
    expect(hist.nowCard.body).not.toBe(refill.nowCard.body);
    expect(hist.nowCard.body).toMatch(/8|27|preferred|standard/i);
    expect(refill.nowCard.body).toMatch(/ready|refill|atorvastatin|lakeview/i);
  }, 180_000);

  it("playbook-only other_plan_cost_explain is available for M004", async () => {
    const s = await ask(
      "DEMO-M004",
      "What should we consider next for pharmacy cost on my plan?",
    );
    const action =
      s.recommendation?.kind ??
      [...(s.diagnostics.nba ?? [])].reverse().find((r) => r.event === "proposal")
        ?.action;
    expect(action).toBe("other_plan_cost_explain");
    expect(s.nowCard.body).not.toMatch(/\$8|\$27/);
  }, 90_000);
});
