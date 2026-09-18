import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  gradeComparison,
  gradeFast90,
  gradeHistorical,
  gradeWrapOrHandoff,
} from "./c05_grader";

type Evidence = {
  sessionId: string;
  historical?: { body?: string } | null;
  fast90?: { body?: string } | null;
  nowCard?: { title?: string; body?: string };
  quotes?: Array<{ drugName: string; pharmacyName: string; estimatedMemberCost: { value: string } }>;
  wrap?: string;
  handoff?: string;
};

function load(p: string): Evidence {
  return JSON.parse(readFileSync(p, "utf8")) as Evidence;
}

const ids = (process.env.C05_EVIDENCE_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

describe.skipIf(ids.length === 0)("C05 live generated drafts (code grader)", () => {
  for (const id of ids) {
    const file = path.join(process.cwd(), "runs", `${id}.evidence.json`);
    it(`${id} exists`, () => {
      expect(existsSync(file)).toBe(true);
    });
    it(`${id} historical / 90-day / comparison / wrap / handoff`, () => {
      const e = load(file);
      const hist = gradeHistorical(e.historical?.body ?? "");
      expect(hist.accept, hist.reasons.join(",")).toBe(true);
      const fast = gradeFast90(e.fast90?.body ?? "");
      expect(fast.accept, fast.reasons.join(",")).toBe(true);
      const cmpText = `${e.nowCard?.body ?? ""} ${JSON.stringify(e.quotes ?? [])}`;
      const cmp = gradeComparison(cmpText);
      expect(cmp.accept, cmp.reasons.join(",")).toBe(true);
      const wrap = gradeWrapOrHandoff(e.wrap ?? "", "wrap");
      expect(wrap.accept, wrap.reasons.join(",")).toBe(true);
      const hand = gradeWrapOrHandoff(e.handoff ?? "", "handoff");
      expect(hand.accept, hand.reasons.join(",")).toBe(true);
    });
  }
});
