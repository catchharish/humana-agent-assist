/**
 * Document-search pre-load only, on two general knowledge questions.
 * Thin member snapshot (no claims/cost-share in context).
 */
import { writeFileSync } from "fs";
import path from "path";
import { postOpenAi, runAnswerLoop, type LoopOpts } from "../lib/answerLoop";
import { MID_MODEL } from "../lib/openai";

const ORIGIN = process.env.SPEED_GATE_ORIGIN || "http://127.0.0.1:3012";
const G1 =
  "On this MAPD plan, why is a 30-day metformin fill cheaper at a preferred retail pharmacy than at a standard retail pharmacy?";
const G2 =
  "After a member enrolls in the CenterWell pharmacy mail service, what happens to a prescription that is already waiting at retail for pickup today?";

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function opts(q: string, searchPreload: boolean, t0: number): LoopOpts {
  return {
    origin: ORIGIN,
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    question: q,
    loadedSnapshot: false,
    shortAnswers: true,
    serviceTier: "priority",
    nbaParallel: false,
    clockStart: t0,
    generation: Date.now(),
    identityVerified: true,
    preload: false,
    preloadSearchOnly: searchPreload,
  };
}

async function main() {
  const ping = await fetch(`${ORIGIN}/api/simulated/benefits/plans/DEMO-MAPD-001`);
  if (!ping.ok) process.exit(1);
  await postOpenAi({
    model: MID_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: 16,
    input: "warmup",
  });
  const rows: Record<string, unknown>[] = [];
  for (const preload of [false, true]) {
    const variant = preload ? "search_preload" : "no_search_preload";
    for (const [id, q] of [
      ["g1_preferred_vs_standard", G1],
      ["g2_mail_vs_today_retail", G2],
    ] as const) {
      console.log("discard", variant, id);
      await runAnswerLoop(opts(q, preload, performance.now()));
      for (let i = 1; i <= 5; i++) {
        const r = await runAnswerLoop(opts(q, preload, performance.now()));
        rows.push({
          variant,
          questionId: id,
          run: i,
          rounds: r.rounds,
          totalMs: r.totalMs,
          lookups: r.roundTraces.map((t) => ({
            round: t.round,
            parallel: t.parallel,
            names: t.lookups.map((l) => l.name),
          })),
          preloadNames: r.preloadNames,
          preloadUsed: r.preloadUsed,
          preloadShareUsed: r.preloadShareUsed,
          over8s: r.over8s,
          answer: r.answer,
        });
        console.log(
          JSON.stringify({
            variant,
            id,
            run: i,
            rounds: r.rounds,
            totalMs: Math.round(r.totalMs),
            share: r.preloadShareUsed,
            used: r.preloadUsed,
            fetched: r.preloadFetchedAnyway,
            over8s: r.over8s,
          }),
        );
      }
    }
  }
  const summary = ["no_search_preload", "search_preload"].flatMap((variant) =>
    ["g1_preferred_vs_standard", "g2_mail_vs_today_retail"].map((questionId) => {
      const rs = rows.filter(
        (r) => r.variant === variant && r.questionId === questionId,
      );
      const totals = rs.map((r) => Number(r.totalMs));
      const rounds = rs.map((r) => Number(r.rounds));
      const shares = rs
        .map((r) => r.preloadShareUsed)
        .filter((x): x is number => typeof x === "number");
      return {
        variant,
        questionId,
        medianRounds: median(rounds),
        medianTotalMs: median(totals),
        slowestTotalMs: Math.max(...totals),
        medianShareUsed: shares.length ? median(shares) : null,
      };
    }),
  );
  const file = path.join(
    process.cwd(),
    "runs",
    `speed_gate_doc_preload_${Date.now()}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), g1: G1, g2: G2, summary, rows }, null, 2),
  );
  console.log("WROTE", file);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
