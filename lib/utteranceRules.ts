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
