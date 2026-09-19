/**
 * Speed-gate remeasure after Harish's 10 decisions.
 */
import { writeFileSync } from "fs";
import path from "path";
import {
  estimateUsd,
  postOpenAi,
  questionCouldChange,
  runAnswerLoop,
  type LoopOpts,
  type LoopResult,
} from "../lib/answerLoop";
import { MID_MODEL } from "../lib/openai";

const MEMBER_ID = "DEMO-M001";
const PLAN_ID = "DEMO-MAPD-001";
const AUTH_ID = "DEMO-AUTH001";
const ORIGIN = process.env.SPEED_GATE_ORIGIN || "http://127.0.0.1:3012";

const Q1 = "Why was my metformin $8 last month and $27 yesterday?";
const Q1_PARTIAL = "Why was my metformin $8 last month and $27 yesterday";
const Q2 =
  "Confirm whether my atorvastatin refill is ready for pickup right now, not just that a request exists; give the pharmacy directory name; then check whether I have an open coverage-review case and report that case's current status and requested medication.";
const Q2_PARTIAL =
  "Confirm whether my atorvastatin refill is ready for pickup right now, not just that a request exists; give the pharmacy directory name; then check whether I have an open coverage-review case and report that case's current status and requested medication";

type Variant = {
  id: string;
  loadedSnapshot: boolean;
  shortAnswers: boolean;
  serviceTier?: "priority";
  startEarly: boolean;
  nbaParallel: boolean;
};

const VARIANTS: Variant[] = [
  {
    id: "isolate_1_loaded",
    loadedSnapshot: true,
    shortAnswers: false,
    startEarly: false,
    nbaParallel: false,
  },
  {
    id: "isolate_2_short",
    loadedSnapshot: false,
    shortAnswers: true,
    startEarly: false,
    nbaParallel: false,
  },
  {
    id: "isolate_5_priority",
    loadedSnapshot: false,
    shortAnswers: false,
    serviceTier: "priority",
    startEarly: false,
    nbaParallel: false,
  },
  {
    id: "isolate_8_early",
    loadedSnapshot: false,
    shortAnswers: false,
    startEarly: true,
    nbaParallel: false,
  },
  {
    id: "after_all",
    loadedSnapshot: true,
    shortAnswers: true,
    serviceTier: "priority",
    startEarly: true,
    nbaParallel: true,
  },
];

function grade(
  questionId: string,
  r: LoopResult,
): { correct: boolean; notes: string[] } {
  const a = r.answer.toLowerCase();
  const notes: string[] = [];
  if (r.supportPartial && questionId === "q1_historical") {
    notes.push(`support_partial:${r.supportNote}`);
    return { correct: false, notes };
  }
  if (questionId === "q1_historical") {
    if (!(/\$?8/.test(a) || a.includes("eight"))) notes.push("missing $8");
    if (!(/\$?27/.test(a) || a.includes("twenty-seven"))) notes.push("missing $27");
    if (!a.includes("oak")) notes.push("missing Oak Street");
    if (!a.includes("lakeview")) notes.push("missing Lakeview");
    if (!a.includes("preferred") || !a.includes("standard")) {
      notes.push("missing preferred/standard");
    }
    return { correct: notes.length === 0, notes };
  }
  if (!a.includes("atorvastatin")) notes.push("missing atorvastatin");
  if (!a.includes("ready")) notes.push("missing ready");
  if (!a.includes("lakeview")) notes.push("missing Lakeview");
  if (!a.includes("jardiance")) notes.push("missing Jardiance");
  if (!a.includes("pending")) notes.push("missing pending");
  return { correct: notes.length === 0, notes };
}

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function baseOpts(v: Variant, question: string, clockStart: number): LoopOpts {
  return {
    origin: ORIGIN,
    memberId: MEMBER_ID,
    planId: PLAN_ID,
    authId: AUTH_ID,
    question,
    loadedSnapshot: v.loadedSnapshot,
    shortAnswers: v.shortAnswers,
    serviceTier: v.serviceTier,
    nbaParallel: v.nbaParallel,
    clockStart,
    generation: Date.now(),
    identityVerified: true,
    dueNow: false,
  };
}

async function oneRun(v: Variant, questionId: string, full: string, partial: string) {
  const clockStart = performance.now();
  let earlyKeep: "keep" | "restart" | undefined;
  let result: LoopResult;
  if (v.startEarly) {
    const first = await runAnswerLoop(baseOpts(v, partial, clockStart));
    if (questionCouldChange(partial, full)) {
      earlyKeep = "restart";
      result = await runAnswerLoop(baseOpts(v, full, clockStart));
    } else {
      earlyKeep = "keep";
      result = first;
    }
  } else {
    result = await runAnswerLoop(baseOpts(v, full, clockStart));
  }
  result.earlyKeep = earlyKeep;
  const g = grade(questionId, result);
  return { ...result, ...g, questionId };
}

async function warmup() {
  await postOpenAi({
    model: MID_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: 16,
    input: "warmup",
  });
}

async function main() {
  const ping = await fetch(`${ORIGIN}/api/simulated/benefits/plans/${PLAN_ID}`);
  if (!ping.ok) {
    console.error("origin not ready", ORIGIN, ping.status);
    process.exit(1);
  }
  console.log("warmup");
  await warmup();
  const all: unknown[] = [];
  let rateLimitErrors = 0;
  for (const v of VARIANTS) {
    for (const [questionId, full, partial] of [
      ["q1_historical", Q1, Q1_PARTIAL],
      ["q2_five_step", Q2, Q2_PARTIAL],
    ] as const) {
      console.log("warm discard", v.id, questionId);
      await oneRun(v, questionId, full, partial);
      for (let i = 1; i <= 5; i++) {
        console.log(v.id, questionId, i);
        const r = await oneRun(v, questionId, full, partial);
        rateLimitErrors += r.rateLimitErrors;
        all.push({
          variant: v.id,
          run: i,
          questionId,
          rounds: r.rounds,
          lookups: r.roundTraces.map((t) => ({
            round: t.round,
            parallel: t.parallel,
            ms: Math.round(t.ms),
            names: t.lookups.map((l) => l.name),
          })),
          firstFactMs: r.firstFactMs,
          writeRoundMs: r.writeRoundMs,
          fullAnswerMs: r.fullAnswerMs,
          totalMs: r.totalMs,
          over8s: r.over8s,
          eightSecondPartial: r.eightSecondPartial,
          correct: r.correct,
          supportPartial: r.supportPartial,
          supportNote: r.supportNote,
          earlyKeep: r.earlyKeep,
          rateLimitErrors: r.rateLimitErrors,
          httpErrors: r.httpErrors,
          usage: r.usage,
          usdStd: estimateUsd(r.usage, false),
          usdPriority: estimateUsd(r.usage, true),
          answer: r.answer,
          notes: r.notes,
        });
        console.log(
          JSON.stringify({
            variant: v.id,
            questionId,
            run: i,
            totalMs: Math.round(r.totalMs),
            firstFactMs: r.firstFactMs && Math.round(r.firstFactMs),
            correct: r.correct,
            supportPartial: r.supportPartial,
            over8s: r.over8s,
            earlyKeep: r.earlyKeep,
            rounds: r.rounds,
          }),
        );
      }
    }
  }
  const measured = all as Array<Record<string, unknown>>;
  const summary = VARIANTS.flatMap((v) =>
    ["q1_historical", "q2_five_step"].map((qid) => {
      const rows = measured.filter(
        (r) => r.variant === v.id && r.questionId === qid,
      );
      const totals = rows.map((r) => Number(r.totalMs));
      const facts = rows
        .map((r) => r.firstFactMs)
        .filter((x): x is number => typeof x === "number");
      const writes = rows
        .map((r) => r.writeRoundMs)
        .filter((x): x is number => typeof x === "number");
      return {
        variant: v.id,
        questionId: qid,
        n: rows.length,
        correct: rows.filter((r) => r.correct).length,
        supportPartial: rows.filter((r) => r.supportPartial).length,
        medianTotalMs: median(totals),
        slowestTotalMs: Math.max(0, ...totals),
        medianFirstFactMs: facts.length ? median(facts) : null,
        slowestFirstFactMs: facts.length ? Math.max(...facts) : null,
        medianWriteRoundMs: writes.length ? median(writes) : null,
        anyOver8s: rows.some((r) => r.over8s),
        rateLimitErrors: rows.reduce((s, r) => s + Number(r.rateLimitErrors), 0),
        usdStd: rows.reduce((s, r) => s + Number(r.usdStd), 0),
        usdPriority: rows.reduce((s, r) => s + Number(r.usdPriority), 0),
      };
    }),
  );
  const out = {
    at: new Date().toISOString(),
    origin: ORIGIN,
    before: {
      file: "runs/speed_gate_1789770868148.json",
      q1: { median: 6549, slowest: 7263, correct: "4/5", over8s: false },
      q2: { median: 6713, slowest: 9011, correct: "5/5", over8s: "1/5" },
      snapshot:
        "thin: prescription names only; claims/plan/cost-share/network NOT in context",
    },
    terraListPrice:
      "standard $2/$12 per 1M in/out; priority/fast 2× = $4/$24 (OpenAI Fast mode)",
    summary,
    rateLimitErrors,
    runs: measured,
  };
  const file = path.join(process.cwd(), "runs", `speed_gate_after_${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("WROTE", file);
  console.log(JSON.stringify({ rateLimitErrors, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
