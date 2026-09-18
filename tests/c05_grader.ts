/** C05 grader: code, not a model. Applied to seeded samples and live generated drafts. */

export type Grade = { accept: boolean; reasons: string[]; notes: string[] };

function fail(reasons: string[], notes: string[] = []): Grade {
  return { accept: reasons.length === 0, reasons, notes };
}

export function gradeHistorical(text: string): Grade {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (!text || !text.trim()) reasons.push("empty_draft");
  const has8 = /\$?\s*8\b/.test(text);
  const has27 = /\$?\s*27\b/.test(text);
  const lake = /lakeview/i.test(text);
  const oak = /oak street/i.test(text);
  if (!(has8 && has27 && lake && oak)) reasons.push("amount_entity_incomplete");
  else notes.push("Attributes $8/$27 to Lakeview and Oak Street.");
  if (/plan changed/i.test(text)) reasons.push("invented_plan_change");
  if (/cause is (that )?lakeview changed/i.test(text)) {
    reasons.push("invented_historical_cause");
  }
  if (/you must enroll|required to enroll|have to enroll/i.test(text)) {
    reasons.push("coercive_enrollment");
  }
  return fail(reasons, notes);
}

export function gradeFast90(text: string): Grade {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (/automatic refill/i.test(text) && /not/i.test(text)) {
    notes.push("States enrollment is not automatic refills.");
  }
  if (/order/i.test(text) && /not/i.test(text)) {
    notes.push("States enrollment is not an order.");
  }
  if (/delivery deadline|arrives in \d+ day/i.test(text)) {
    reasons.push("invented_delivery_deadline");
  }
  if (/you must enroll|have to enroll/i.test(text)) {
    reasons.push("coercive_enrollment");
  }
  if (!/90-day|90 day/i.test(text)) reasons.push("missing_90day_scope");
  return fail(reasons, notes);
}

export function gradeComparison(text: string): Grade {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (!text || !text.trim()) reasons.push("empty_draft");
  if (/cheapest (pharmacy|overall|always)/i.test(text)) {
    reasons.push("false_cheapest_claim");
  }
  if (/guaranteed savings/i.test(text)) reasons.push("guaranteed_savings");
  if (/\$6|6\.00/.test(text) && /atorvastatin/i.test(text)) {
    notes.push("Mentions atorvastatin $6 equality class.");
  }
  if (/18|24/.test(text) && /metformin/i.test(text)) {
    notes.push("Mentions metformin 90-day estimates.");
  }
  return fail(reasons, notes);
}

export function gradeWrapOrHandoff(text: string, kind: "wrap" | "handoff"): Grade {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (!text || !text.trim()) reasons.push("empty_draft");
  if (/approved/.test(text.toLowerCase()) && /jardiance|coverage/.test(text.toLowerCase())) {
    reasons.push("false_coverage_approval");
  }
  if (/you must enroll|required to enroll/i.test(text)) {
    reasons.push("coercive_enrollment");
  }
  if (kind === "handoff" && /pending/i.test(text)) {
    notes.push("Keeps coverage pending.");
  }
  if (kind === "wrap" && /connect/i.test(text) && /not/i.test(text) && /determin/i.test(text)) {
    notes.push("Distinguishes connection from determination.");
  }
  if (kind === "wrap" && /metformin/i.test(text)) {
    notes.push("Mentions metformin enrollment scope.");
  }
  return fail(reasons, notes);
}
