/** Ten isolated Harry suggestion runs. Not a product routing table. */
import { writeFileSync } from "fs";

const ORIGIN = process.env.ORIGIN ?? "http://127.0.0.1:3000";
const Q =
  "My last retail fill cost more than I expected. What should we consider next for pharmacy on this plan?";

type Session = {
  sessionId: string;
  recommendation?: { kind?: string; status?: string } | null;
  nowCard?: { title?: string; body?: string };
  diagnostics?: {
    nba?: Array<{
      event?: string;
      action?: string;
      stop?: string;
      reasons?: string[];
    }>;
  };
  modelHealth?: { terra?: { ok?: boolean; status?: number; error?: string } };
};

async function one(): Promise<Record<string, unknown>> {
  const start = await fetch(`${ORIGIN}/api/session/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: "nba_member",
      memberId: "DEMO-M001",
      injectedDelayMs: 0,
    }),
  });
  const started = (await start.json()) as { session: Session };
  const sid = started.session.sessionId;
  await fetch(`${ORIGIN}/api/session/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: sid,
      event: { id: "e-auth", type: "system", name: "authorization" },
    }),
  });
  const t0 = Date.now();
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
        text: Q,
      },
    }),
  });
  const end = Date.now() + 60_000;
  let session = started.session;
  while (Date.now() < end) {
    const r = await fetch(`${ORIGIN}/api/session/state?sessionId=${sid}`);
    if (r.ok) {
      session = ((await r.json()) as { session?: Session }).session ?? session;
      const nba = session.diagnostics?.nba ?? [];
      if (nba.length > 0 || session.recommendation) break;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  const nba = session.diagnostics?.nba ?? [];
  const proposal = nba.find((n) => n.event === "proposal");
  const stop = nba.find((n) => n.event === "hard_stop");
  return {
    sessionId: sid,
    waitedMs: Date.now() - t0,
    action: session.recommendation?.kind ?? proposal?.action ?? null,
    recStatus: session.recommendation?.status ?? null,
    stop: stop?.stop ?? null,
    terra: session.modelHealth?.terra ?? null,
    nowTitle: session.nowCard?.title ?? null,
  };
}

async function main() {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const row = await one();
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const actions = rows.map((r) => String(r.action));
  const same = actions.filter((a) => a && a !== "null" && a !== "none");
  const summary = {
    of: 10,
    withAction: same.length,
    actions,
    sameAction: same.length ? same[0] : null,
    sameCount: same.filter((a) => a === same[0]).length,
  };
  console.log("SUMMARY", JSON.stringify(summary, null, 2));
  writeFileSync(
    "runs/harry_nba_10.json",
    JSON.stringify({ at: new Date().toISOString(), rows, summary }, null, 2),
  );
  if (summary.withAction !== 10 || summary.sameCount !== 10) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
