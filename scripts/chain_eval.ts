/**
 * ≥10 live multi-step questions across members. Graph recommendation input.
 */
import { writeFileSync } from "fs";
import path from "path";
import { runAnswerLoop, type LoopOpts, type LoopResult } from "../lib/answerLoop";

const ORIGIN = process.env.ORIGIN ?? process.env.SPEED_GATE_ORIGIN ?? "http://127.0.0.1:3012";

type Case = {
  id: string;
  memberId: string;
  planId: string;
  authId: string;
  question: string;
  comparisonConsentYes?: boolean;
  expect: (r: LoopResult) => string[];
};

const CASES: Case[] = [
  {
    id: "c01_harry_827",
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    question: "Why was my metformin $8 last month and $27 yesterday?",
    expect: (r) => {
      const n: string[] = [];
      const a = r.answer.toLowerCase();
      if (!(/\$?8/.test(a) || a.includes("eight"))) n.push("missing $8");
      if (!(/\$?27/.test(a) || a.includes("twenty-seven"))) n.push("missing $27");
      if (!a.includes("preferred") || !a.includes("standard")) n.push("missing preferred/standard");
      return n;
    },
  },
  {
    id: "c02_harry_five_step",
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    question:
      "Confirm whether my atorvastatin refill is ready for pickup right now, not just that a request exists; give the pharmacy directory name; then check whether I have an open coverage-review case and report that case's current status and requested medication.",
    expect: (r) => {
      const n: string[] = [];
      const a = r.answer.toLowerCase();
      if (!a.includes("atorvastatin")) n.push("missing atorvastatin");
      if (!a.includes("ready")) n.push("missing ready");
      if (!a.includes("jardiance")) n.push("missing Jardiance");
      if (!a.includes("pending")) n.push("missing pending");
      return n;
    },
  },
  {
    id: "c03_harry_preferred_rule",
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    question: "Why can the same 30-day fill cost more at a standard pharmacy than a preferred one on this plan?",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      return a.includes("preferred") && a.includes("standard") ? [] : ["missing preferred/standard"];
    },
  },
  {
    id: "c04_harry_mail_vs_today",
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    question:
      "If I enroll in CenterWell mail, does that change today's retail atorvastatin pickup, and what happens to the existing prescription?",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      return /pickup|enroll|today/.test(a) ? [] : ["missing enrollment/pickup"];
    },
  },
  {
    id: "c05_m002_lisinopril",
    memberId: "DEMO-M002",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH002",
    question: "What did I pay for lisinopril on 2026-09-01 and which pharmacy filled it?",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      const n: string[] = [];
      if (!a.includes("lisinopril")) n.push("missing lisinopril");
      return n;
    },
  },
  {
    id: "c06_m004_other_plan",
    memberId: "DEMO-M004",
    planId: "DEMO-OTHER-PLAN",
    authId: "DEMO-AUTH004",
    question: "Why was my metformin $12? Use my plan's cost rule, not MAPD-001.",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      const n: string[] = [];
      if (a.includes("$8") || a.includes("$27")) n.push("leaked Harry amounts");
      if (!/12/.test(a)) n.push("missing 12");
      return n;
    },
  },
  {
    id: "c07_harry_case_chain",
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    question:
      "Look up my open coverage-review cases, then report the case id, status, and requested medication from the case record itself.",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      const n: string[] = [];
      if (!a.includes("demo-cvr001") && !a.includes("cvr001")) n.push("missing case id");
      if (!a.includes("pending")) n.push("missing pending");
      return n;
    },
  },
  {
    id: "c08_m003_ozempic_case",
    memberId: "DEMO-M003",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH003",
    question:
      "Do I have an open coverage-review case? If so, what medication is requested and what is the status — do not approve it.",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      const n: string[] = [];
      if (!a.includes("ozempic")) n.push("missing Ozempic");
      if (!a.includes("pending")) n.push("missing pending");
      return n;
    },
  },
  {
    id: "c09_m005_mail_and_cases",
    memberId: "DEMO-M005",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH005",
    question:
      "Where was my last atorvastatin fill, what did I pay, and do I have any open coverage-review case?",
    expect: (r) => {
      const a = r.answer.toLowerCase();
      const n: string[] = [];
      if (!a.includes("atorvastatin")) n.push("missing atorvastatin");
      if (!/centerwell|preferred/.test(a)) n.push("missing CenterWell/preferred");
      return n;
    },
  },
  {
    id: "c10_harry_quotes_after_consent",
    memberId: "DEMO-M001",
    planId: "DEMO-MAPD-001",
    authId: "DEMO-AUTH001",
    comparisonConsentYes: true,
    question:
      "Comparison consent is already yes. What are the prospective 90-day member costs at CenterWell versus Lakeview for metformin on this member?",
    expect: (r) => {
      const n: string[] = [];
      if (!r.toolsUsed.includes("getQuotes")) n.push("did not call getQuotes");
      const a = r.answer;
      if (!/\$/.test(a) && !/\d/.test(a)) n.push("no amount in answer");
      return n;
    },
  },
];

function opts(c: Case): LoopOpts {
  return {
    origin: ORIGIN,
    memberId: c.memberId,
    planId: c.planId,
    authId: c.authId,
    question: c.question,
    loadedSnapshot: true,
    shortAnswers: true,
    serviceTier: "priority",
    nbaParallel: false,
    clockStart: performance.now(),
    generation: 1,
    preload: false,
    preloadSearchOnly: true,
    comparisonConsentYes: Boolean(c.comparisonConsentYes),
    paintNow: false,
  };
}

async function main() {
  const rows = [];
  for (const c of CASES) {
    const t0 = performance.now();
    let result: LoopResult | null = null;
    let error: string | null = null;
    try {
      result = await runAnswerLoop(opts(c));
    } catch (err) {
      error = String(err);
    }
    const notes = result ? c.expect(result) : [error ?? "no result"];
    const chained =
      (result?.rounds ?? 0) >= 2 || (result?.toolsUsed.length ?? 0) >= 2;
    rows.push({
      id: c.id,
      memberId: c.memberId,
      question: c.question,
      error,
      correct: notes.length === 0,
      notes,
      chained,
      rounds: result?.rounds ?? null,
      toolsUsed: result?.toolsUsed ?? [],
      totalMs: result?.totalMs ?? performance.now() - t0,
      over8s: result?.over8s ?? (performance.now() - t0 > 8000),
      supportPartial: result?.supportPartial ?? null,
      answer: result?.answer ?? null,
    });
    console.log(c.id, notes.length === 0 ? "ok" : notes.join(";"), result?.totalMs);
  }
  const correct = rows.filter((r) => r.correct).length;
  const over8 = rows.filter((r) => r.over8s).length;
  const broke = rows.filter((r) => r.error || !r.correct).length;
  const recommendGraph =
    over8 >= 3 || (rows.filter((r) => r.error).length >= 3)
      ? "Build a thin fact graph next: several questions still miss 8s or break on multi-hop ids."
      : "Do not build a graph in this pass. REST tools plus snapshot cover the ten questions well enough; remaining misses are model/latency or support-check, not missing joins.";
  const out = {
    at: new Date().toISOString(),
    origin: ORIGIN,
    correct,
    of: rows.length,
    over8s: over8,
    breaks: broke,
    recommendGraph,
    rows,
  };
  const file = path.join(process.cwd(), "runs", `chain_eval_${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ correct, of: rows.length, over8, broke, recommendGraph, file }, null, 2));
  if (correct !== rows.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
