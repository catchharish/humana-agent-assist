import { describe, expect, it } from "vitest";
import { originUp } from "./driver";
import type { SessionState } from "@/lib/types";

const live = await originUp();
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";

async function memberQuestion(memberId: string, text: string) {
  const start = await fetch(`${ORIGIN}/api/session/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: "nba_member",
      memberId,
      injectedDelayMs: 0,
    }),
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
  const end = Date.now() + 60_000;
  let session = started.session;
  while (Date.now() < end) {
    const r = await fetch(`${ORIGIN}/api/session/state?sessionId=${sid}`);
    if (r.ok) {
      session = ((await r.json()) as { session?: SessionState }).session ?? session;
      const nba = session.diagnostics?.nba ?? [];
      if (nba.length > 0 || session.recommendation) break;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  return session;
}

describe.skipIf(!live)("NBA across members", () => {
  it("Harry gets a suggestion; enrolled/DNC/nothing-to-offer do not; other plan is not Harry's", async () => {
    const q =
      "My last retail fill cost more than I expected. What should we consider next for pharmacy on this plan?";
    const harry = await memberQuestion("DEMO-M001", q);
    const m002 = await memberQuestion("DEMO-M002", q);
    const m003 = await memberQuestion("DEMO-M003", q);
    const m005 = await memberQuestion("DEMO-M005", q);
    const m004 = await memberQuestion("DEMO-M004", q);

    expect(harry.recommendation?.status === "pending" || harry.diagnostics.nba.some((r) => r.event === "proposal" && r.action && r.action !== "none")).toBe(true);
    expect(harry.nowCard.body).not.toMatch(/\$15\.00|prospective/i);

    const stopOf = (s: SessionState) =>
      s.diagnostics.nba.map((r) => r.stop).filter(Boolean);
    expect(stopOf(m002)).toContain("already_enrolled");
    expect(m002.recommendation).toBeNull();
    expect(stopOf(m003)).toContain("do_not_contact");
    expect(m003.recommendation).toBeNull();
    const m005None = m005.diagnostics.nba.filter(
      (r) => r.event === "proposal" && r.action === "none",
    );
    expect(m005None.length).toBeGreaterThan(0);
    expect(m005None.some((r) => r.source === "model")).toBe(true);
    expect(stopOf(m005)).not.toContain("already_enrolled");
    expect(m005.recommendation).toBeNull();
    expect(
      (m005None[0].reasons as string[] | undefined)?.length ?? 0,
    ).toBeGreaterThan(0);

    const m004Text = `${m004.recommendation?.body ?? ""} ${JSON.stringify(m004.diagnostics.nba)}`;
    expect(m004Text).not.toMatch(/DEMO-M001|Harry|\$8|\$27/);
    expect(
      m004.recommendation?.status === "pending" ||
        m004.diagnostics.nba.some((r) => r.event === "proposal"),
    ).toBe(true);
  }, 300_000);
});
