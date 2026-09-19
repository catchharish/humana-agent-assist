/** Post-answer support check. Does not choose tools. Session plan only. */

export function supportCheck(args: {
  question: string;
  answer: string;
  toolsUsed: string[];
  snapshotHasPlanRule: boolean;
  sources: string[];
}): { partial: boolean; body: string; note: string | null } {
  const a = args.answer.toLowerCase();
  const citesRule =
    args.toolsUsed.includes("getCostShare") ||
    args.toolsUsed.includes("searchKnowledge") ||
    args.snapshotHasPlanRule ||
    args.sources.some((s) =>
      /cost-share|policy|plan rule|governed guidance/i.test(s),
    );
  const explainsPrice =
    (/\$?\s*8/.test(args.question) && /\$?\s*27/.test(args.question)) ||
    /why (was|were|did).*(dollar|\$|charg|cost|price)/i.test(args.question);
  const statesCause =
    /\b(because|so the|explains|due to|caused by|network classification|preferred vs)\b/i.test(
      args.answer,
    );
  const statesApproval = /\b(approv|authorized coverage|coverage granted)\b/i.test(
    args.answer,
  );
  const statesEligibility = /\b(you are eligible|eligible for enrollment)\b/i.test(
    args.answer,
  );

  if ((explainsPrice || (statesCause && /\$/.test(a))) && !citesRule) {
    return {
      partial: true,
      body: "Charges confirmed; rule not confirmed.",
      note: "cause_without_plan_rule",
    };
  }
  if (statesApproval) {
    return {
      partial: true,
      body: "This role cannot determine coverage. Status only.",
      note: "approval_claim",
    };
  }
  if (statesEligibility && !citesRule) {
    return {
      partial: true,
      body: "Eligibility not confirmed from a plan-rule source.",
      note: "eligibility_without_rule",
    };
  }
  return { partial: false, body: args.answer, note: null };
}
