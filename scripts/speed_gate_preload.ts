/**
 * Pre-load on vs off. Loaded snapshot + short answers + priority Terra.
 * 5 warm counted runs per question per variant.
 */
import { writeFileSync } from "fs";
import path from "path";
import {
  postOpenAi,
  runAnswerLoop,
  type LoopOpts,
} from "../lib/answerLoop";
import { MID_MODEL } from "../lib/openai";

const ORIGIN = process.env.SPEED_GATE_ORIGIN || "http://127.0.0.1:3012";
const MEMBER_ID = "DEMO-M001";
const PLAN_ID = "DEMO-MAPD-001";
const AUTH_ID = "DEMO-AUTH001";
const Q1 = "Why was my metformin $8 last month and $27 yesterday?";
const Q2 =
  "Confirm whether my atorvastatin refill is ready for pickup right now, not just that a request exists; give the pharmacy directory name; then check whether I have an open coverage-review case and report that case's current status and requested medication.";

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function opts(question: string, preload: boolean, clockStart: number): LoopOpts {
  return {
    origin: ORIGIN,
    memberId: MEMBER_ID,
    planId: PLAN_ID,
    authId: AUTH_ID,
    question,
    loadedSnapshot: true,
    shortAnswers: true,
    serviceTier: "priority",
    nbaParallel: false,
    clockStart,
    generation: Date.now(),
    identityVerified: true,
    dueNow: false,
    preload,
    comparisonConsentYes: false,
  };
}

async function main() {
  const ping = await fetch(`${ORIGIN}/api/simulated/benefits/plans/${PLAN_ID}`);
  if (!ping.ok) {
    console.error("origin not ready", ping.status);
    process.exit(1);
  }
  await postOpenAi({
    model: MID_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: 16,
    input: "warmup",
  });
  const rows: Record<string, unknown>[] = [];
  for (const preload of [false, true]) {
    const variant = preload ? "with_preload" : "without_preload";
    for (const [questionId, q] of [
      ["q1_historical", Q1],
      ["q2_five_step", Q2],
    ] as const) {
      console.log("discard", variant, questionId);
      await runAnswerLoop(opts(q, preload, performance.now()));
      for (let i = 1; i <= 5; i++) {
        const r = await runAnswerLoop(opts(q, preload, performance.now()));
        const rec = {
          variant,
          questionId,
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
          preloadFetchedAnyway: r.preloadFetchedAnyway,
          preloadShareUsed: r.preloadShareUsed,
          over8s: r.over8s,
          supportPartial: r.supportPartial,
          answer: r.answer,
        };
        rows.push(rec);
        console.log(
          JSON.stringify({
            variant,
            questionId,
            run: i,
            rounds: r.rounds,
            totalMs: Math.round(r.totalMs),
            share: r.preloadShareUsed,
            pre: r.preloadNames,
            used: r.preloadUsed,
            fetched: r.preloadFetchedAnyway,
            over8s: r.over8s,
          }),
        );
      }
    }
  }
  const summary = ["without_preload", "with_preload"].flatMap((variant) =>
    ["q1_historical", "q2_five_step"].map((questionId) => {
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
        slowestTotalMs: Math.max(0, ...totals),
        medianShareUsed: shares.length ? median(shares) : null,
        anyOver8s: rs.some((r) => r.over8s),
      };
    }),
  );
  const file = path.join(
    process.cwd(),
    "runs",
    `speed_gate_preload_${Date.now()}.json`,
  );
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
  console.log("WROTE", file);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
