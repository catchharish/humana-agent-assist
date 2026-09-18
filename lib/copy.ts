export const NUDGE_PRICING = "Pricing statement required before an estimate.";
export const NUDGE_PARAPHRASE = "Wording differs—read the exact statement.";
export const NUDGE_CLOSING = "Closing speech could not be verified.";

export const CLARIFY_INTEREST =
  "To confirm: would you like to hear the retail and delivery estimates for both of your existing medicines? Hearing those estimates does not enroll you in anything.";

export const OBJECTION_BODY =
  "We can include your retail options in the comparison. You do not have to move both medicines, and today's pickup stays as it is.";

function joinList(items: string[]): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return "the named medicines";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

export function offerBody(p: { mailPharmacy: string }): string {
  return `After today's servicing, offer a comparison of retail and ${p.mailPharmacy} delivery for the existing medicines. Eligibility plus the cost question is a reason to offer information, not a recommendation to enroll.`;
}

export function enrollmentReadback(p: {
  mailPharmacy: string;
  deliveryMedications: string[];
  retailMedications: string[];
  pickupPharmacy: string;
}): string {
  const delivery = joinList(p.deliveryMedications);
  const retail = p.retailMedications.length
    ? `${joinList(p.retailMedications)} stay at retail, and `
    : "";
  return `You want to enroll in the ${p.mailPharmacy} pharmacy service for future ${delivery} fills. ${retail}today's ready refill stays at ${p.pickupPharmacy}. This does not order medication, start automatic refills, or change your health-plan membership. Do you want me to submit that enrollment?`;
}

export function transferOffer(p: {
  caseId: string;
  requestedMedication: string;
}): string {
  return `Recommend a warm transfer to Coverage Review for the existing pending ${p.requestedMedication} case. That role can review ${p.caseId}. This role cannot determine coverage. A draft or click is not a connection.`;
}

export function outcomeWithout(p: { historicalNeed: string }): string {
  return `Without the copilot, the pricing statement in this call is never read and the miss is found weeks later only if the call happens to be sampled; the ${p.historicalNeed} answer is a search across records; the wrap is reconstructed from memory.`;
}

export function outcomeWith(p: { memberGiven: string }): string {
  return `With it, the exact wording is on screen before the estimate, the miss is caught within seconds (1-second design target, to be measured), the exact statement is read before ${p.memberGiven} makes a choice, the call is recorded honestly as delivered correctly, but late, and the wrap and handoff are drafted from evidence. Do not describe the pricing moment as prevention.`;
}
