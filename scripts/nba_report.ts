/**
 * Live NBA cards (Harry, M004) plus five Harry suggestion runs.
 */
import { writeFileSync } from "fs";
import path from "path";
import { readFileSync } from "fs";
import type { SessionState } from "../lib/types";

const ORIGIN = process.env.ORIGIN ?? "http://127.0.0.1:3012";
const Q =
  "My last retail fill cost more than I expected. What should we consider next for pharmacy on this plan?";

type Knowledge = { id: string; kind?: string; text: string };

function playbooks() {
  const rows = JSON.parse(
    readFileSync(path.join(process.cwd(), "fixtures/knowledge.json"), "utf8"),
  ) as Knowledge[];
  return new Map(rows.filter((r) => r.kind === "playbook").map((r) => [r.id, r.text]));
}

async function memberQuestion(memberId: string, text: string) {
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
      const nba = session.diagnostics?.nba ?? [];
      if (nba.length > 0 || session.recommendation) break;
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  return session;
}

function card(label: string, s: SessionState, books: Map<string, string>) {
  const rec = s.recommendation;
  const proposal = [...(s.diagnostics.nba ?? [])].reverse().find((r) => r.event === "proposal");
  const ids = (rec?.playbookIds ?? (proposal?.playbookIds as string[] | undefined) ?? []) as string[];
  return {
    label,
    memberId: s.member?.memberId,
    action: rec?.kind ?? proposal?.action ?? null,
    title: rec?.title ?? proposal?.title ?? null,
    body: rec?.body ?? null,
    reasons: rec?.reasons ?? proposal?.reasons ?? [],
    facts: rec?.facts ?? proposal?.facts ?? [],
    considered: rec?.considered ?? proposal?.considered ?? [],
    preferredVsMail: rec?.preferredVsMail ?? proposal?.preferredVsMail ?? "",
    playbookIds: ids,
    playbookPassages: ids.map((id) => ({ id, text: books.get(id) ?? "(not in fixture)" })),
    hardStops: s.diagnostics.nba.filter((r) => r.event === "hard_stop"),
    proposalLog: proposal,
  };
}

async function main() {
  const books = playbooks();
  const harry = await memberQuestion("DEMO-M001", Q);
  const m004 = await memberQuestion("DEMO-M004", Q);
  const m005 = await memberQuestion("DEMO-M005", Q);
  const five: ReturnType<typeof card>[] = [];
  for (let i = 0; i < 5; i++) {
    five.push(card(`harry_run_${i + 1}`, await memberQuestion("DEMO-M001", Q), books));
  }
  const out = {
    at: new Date().toISOString(),
    harry: card("Harry DEMO-M001", harry, books),
    m004: card("M004 DEMO-M004", m004, books),
    m005: card("M005 DEMO-M005", m005, books),
    harryFive: five,
    sameActionAllFive: five.every((c) => c.action === five[0]?.action),
    actions: five.map((c) => c.action),
  };
  const file = path.join(process.cwd(), "runs", `nba_cards_${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("wrote", file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
