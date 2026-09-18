import { describe, expect, it } from "vitest";
import { interpretUtterance } from "@/lib/interpret";
import { classifyLunaTrigger } from "@/lib/triggers";
import { createSession, upsertNeed } from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

const run = process.env.RUN_LUNA_LAT === "1";

function median(xs: number[]) {
  const s = [...xs].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stats(label: string, rows: Array<Record<string, number | null>>) {
  const keys = ["ms", "ttftMs", "input_tokens", "output_tokens"] as const;
  const out: Record<string, { median: number; max: number }> = {};
  for (const k of keys) {
    const xs = rows.map((r) => Number(r[k])).filter((n) => Number.isFinite(n));
    out[k] = { median: median(xs), max: xs.length ? Math.max(...xs) : NaN };
  }
  console.log(label, { n: rows.length, rows, summary: out });
  return out;
}

function session() {
  return createSession({
    disclosures: [] as DisclosureRequirement[],
    disclosureFetch: "test",
  });
}

export async function measureInterpret10() {
  const s = session();
  s.callType = "Refill";
  s.currentNeed = "opening";
  await interpretUtterance(s, {
    speaker: "member",
    stability: "final",
    text: "warmup compact schema",
  });
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const r = await interpretUtterance(s, {
      speaker: "member",
      stability: i % 2 === 0 ? "partial" : "final",
      text: "Has the bottle I requested earlier shown up in the system?",
    });
    rows.push({
      ms: r.ms,
      ttftMs: r.ttftMs,
      input_tokens: r.usage?.input_tokens ?? null,
      output_tokens: r.usage?.output_tokens ?? null,
      cached_tokens: r.usage?.cached_tokens ?? null,
      ok: r.ok ? 1 : 0,
    });
  }
  return stats("interpret_10", rows);
}

export async function measureC01Trigger(n = 10) {
  const s = session();
  upsertNeed(s, "historical_price", { status: "active" });
  s.currentNeed = "historical price";
  await classifyLunaTrigger(s, {
    speaker: "advocate",
    stability: "final",
    text: "warmup trigger",
  });
  const rows: Array<Record<string, number | null>> = [];
  let last: Awaited<ReturnType<typeof classifyLunaTrigger>> | null = null;
  for (let i = 0; i < n; i++) {
    last = await classifyLunaTrigger(s, {
      speaker: "advocate",
      stability: "final",
      text: "For a 90-day atorvastatin supply, the Lakeview estimate is fifteen dollars.",
    });
    rows.push({
      ms: last.latencyMs,
      ttftMs: last.ttftMs,
      input_tokens: null,
      output_tokens: null,
    });
  }
  const summary = stats("c01_trigger", rows);
  const over1s = rows.filter((r) => Number(r.ms) > 1000).length;
  console.log("c01_over_1s", over1s, "of", rows.length);
  return { summary, last, over1s, n: rows.length };
}

describe.skipIf(!run)("luna latency pass", () => {
  it("10 warm interpret + C01 trigger", async () => {
    const interp = await measureInterpret10();
    const c01 = await measureC01Trigger();
    expect(interp.ms.median).toBeGreaterThan(0);
    expect(c01.summary.ms.median).toBeGreaterThan(0);
  }, 180_000);

  it("C01 trigger 20 warm with hedge and priority", async () => {
    const c01 = await measureC01Trigger(20);
    expect(c01.summary.ms.median).toBeGreaterThan(0);
    console.log("c01_priority_20", {
      median: c01.summary.ms.median,
      max: c01.summary.ms.max,
      over1s: c01.over1s,
      n: c01.n,
      last: c01.last?.classification,
      fired: c01.last?.fired,
    });
  }, 180_000);
});
