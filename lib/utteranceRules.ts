export type UtteranceRules = {
  ruleSetId: string;
  ninetyDayDuration: string[];
  ninetyDayQuestionCue: string[];
  ninetyDayExclude: string[];
  advocateServiceIntro: string[];
  comparisonHedge: string[];
  comparisonAbsolute: string[];
  scopedComparisonAsk: string[];
  compoundQuestion: string[];
  readyForPickup: string[];
  splitElection: string[];
  enrollmentAbsolute: string[];
  withdraw: string[];
  firmRefusal: string[];
};

export function matchesAny(patterns: string[] | undefined, text: string) {
  const sample = text.trim();
  return (patterns ?? []).some((p) => new RegExp(p, "i").test(sample));
}

export function matchesAll(patterns: string[] | undefined, text: string) {
  const sample = text.trim();
  const list = patterns ?? [];
  if (list.length === 0) return false;
  return list.every((p) => new RegExp(p, "i").test(sample));
}

export function quoteAmountsMayRender(comparison: string) {
  return comparison === "absolute_yes";
}

export function isNinetyDayQuestion(
  rules: UtteranceRules | null,
  text: string,
): boolean {
  if (!rules) return false;
  if (matchesAny(rules.ninetyDayExclude, text)) return false;
  return (
    matchesAny(rules.ninetyDayDuration, text) &&
    matchesAny(rules.ninetyDayQuestionCue, text)
  );
}

export type ComparisonCodeDecision = "absolute_yes" | "hedge" | "wait";

const AFFIRM =
  /^(yes|yeah|yep|sure|please|absolutely|ok|okay|go ahead|i(?:['’]d| would) like that)([,.]|\s|$)/i;

export function namedMedicationsInText(text: string): string[] {
  const names = ["metformin", "atorvastatin", "jardiance"];
  const lower = text.toLowerCase();
  return names.filter((n) => lower.includes(n));
}

export type EnrollmentCodeDecision =
  | "absolute_yes"
  | "hedge"
  | "clarify"
  | "wait";

/** Enrollment yes: member final, no hedge, pending matching readback, named meds = draft or none. */
export function classifyEnrollmentConsent(args: {
  rules: UtteranceRules | null;
  speaker: string;
  text: string;
  stability: string;
  draftMedications: string[];
  readback: string;
  readbackPending: boolean;
}): EnrollmentCodeDecision {
  if (args.speaker !== "member") return "wait";
  if (args.stability !== "final" && args.stability !== "corrected") return "wait";
  if (args.draftMedications.length === 0 || !args.readback.trim()) return "wait";
  if (!args.readbackPending) return "clarify";
  if (matchesAny(args.rules?.comparisonHedge, args.text)) return "hedge";
  const named = namedMedicationsInText(args.text);
  if (
    args.draftMedications.length === 1 &&
    /\bboth\b|\ball of them\b|\bthe other\b/i.test(args.text)
  ) {
    return "clarify";
  }
  if (named.length > 0) {
    const want = new Set(args.draftMedications.map((m) => m.toLowerCase()));
    const got = new Set(named);
    if (want.size !== got.size || [...want].some((m) => !got.has(m))) {
      return "clarify";
    }
  }
  if (AFFIRM.test(args.text.trim()) && !matchesAny(args.rules?.comparisonHedge, args.text)) {
    return "absolute_yes";
  }
  return "wait";
}

export function isDirectNamedQuoteAsk(text: string): boolean {
  return (
    /\b(estimate|quote|price|cost)\b/i.test(text) &&
    (/\b(lakeview|oak street|centerwell)\b/i.test(text) ||
      /\b(metformin|atorvastatin)\b/i.test(text))
  );
}

export function classifyComparisonConsent(args: {
  rules: UtteranceRules | null;
  speaker: string;
  text: string;
  stability: string;
  optionalWorkSuppressed: boolean;
  scopedPending: boolean;
  lastAdvocate: string;
}): ComparisonCodeDecision {
  if (args.optionalWorkSuppressed) return "wait";
  if (args.speaker !== "member") return "wait";
  if (!args.rules) return "wait";
  if (args.stability !== "final" && args.stability !== "corrected") return "wait";
  if (matchesAny(args.rules.comparisonHedge, args.text)) return "hedge";
  if (matchesAny(args.rules.compoundQuestion, args.lastAdvocate)) return "hedge";
  if (
    args.scopedPending &&
    matchesAny(args.rules.comparisonAbsolute, args.text)
  ) {
    return "absolute_yes";
  }
  return "wait";
}
