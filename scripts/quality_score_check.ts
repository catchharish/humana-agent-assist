/**
 * Verification helper for the after-call Quality Score.
 *
 * Runs real calls, then reads the score back from the run log through the same
 * endpoint the UI uses. Prints the advocate's words so the numbers can be
 * compared by eye against the settled obligations in the session.
 */
import { runScenario } from "../tests/driver";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";

type Score = {
  counts: Record<string, number>;
  requirements: Array<{
    requirementId: string;
    plainName: string;
    applied: boolean;
    finalStatus: string;
    outcome: string | null;
    missAtMs: number | null;
    msToNudge: number | null;
    msToExact: number | null;
    checkedBy: string | null;
  }>;
  misses: Array<{
    plainName: string;
    msToNudge: number | null;
    msToExact: number | null;
    checkedBy: string | null;
  }>;
  evidence: Record<string, unknown[]>;
  logRecords: number;
};

function line(score: Score): string {
  const words: Record<string, string> = {
    required: `required statement${score.counts.required === 1 ? "" : "s"}`,
    on_time: "read on time",
    late_corrected: "read late, corrected on the call",
    never_corrected: "never corrected",
    could_not_verify: "could not verify",
  };
  return Object.keys(words)
    .filter((k) => k === "never_corrected" || score.counts[k] > 0)
    .map((k) => `${score.counts[k]} ${words[k]}`)
    .join(" · ");
}

async function main() {
  const targets = (process.env.SCENARIOS ?? "t01_m2a,t03b,t02a").split(",");
  for (const scenarioId of targets) {
    console.log(`\n================ ${scenarioId} ================`);
    const session = await runScenario({ scenarioId, compressMs: 15 });
    const resp = await fetch(
      `${ORIGIN}/api/session/quality?sessionId=${session.sessionId}`,
    );
    const { score } = (await resp.json()) as { score: Score };

    console.log(`session        ${session.sessionId}`);
    console.log(`member         ${session.selectedMemberId}`);
    console.log(
      `settled        greeting=${session.greeting} pricing=${session.pricing} closing=${session.closing}`,
    );
    console.log(`log records    ${score.logRecords}`);
    console.log(`SCORE LINE     ${line(score)}`);
    for (const r of score.requirements) {
      console.log(
        `  ${r.plainName.padEnd(20)} applied=${String(r.applied).padEnd(5)} final=${r.finalStatus.padEnd(23)} bucket=${r.outcome ?? "-"}`,
      );
    }
    for (const m of score.misses) {
      console.log(
        `  MISS ${m.plainName}: nudge=${m.msToNudge}ms exact=${m.msToExact}ms checkedBy=${m.checkedBy}`,
      );
    }
    const total =
      score.counts.on_time +
      score.counts.late_corrected +
      score.counts.never_corrected +
      score.counts.could_not_verify;
    if (total !== score.counts.required) {
      throw new Error(
        `buckets (${total}) do not sum to required (${score.counts.required})`,
      );
    }
    for (const [bucket, count] of Object.entries(score.counts)) {
      const recs = score.evidence[bucket] ?? [];
      if (count > 0 && recs.length === 0) {
        throw new Error(`${bucket} is ${count} but has no log lines behind it`);
      }
    }
    console.log("  evidence counts:", 
      Object.fromEntries(
        Object.entries(score.evidence).map(([k, v]) => [k, v.length]),
      ),
    );
  }
}

void main();
