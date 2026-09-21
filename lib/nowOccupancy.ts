import type { SessionState } from "@/lib/types";

type OccupancySession = Pick<
  SessionState,
  | "greetingLocked"
  | "greeting"
  | "identityStatus"
  | "auth"
  | "pricingExactDelivered"
  | "pricing"
  | "closing"
  | "disclosures"
>;

/** Required pricing wording occupies Now until the exact reading is delivered. */
export function requiredPricingOnNow(session: OccupancySession): boolean {
  return (
    !session.pricingExactDelivered &&
    (session.pricing === "due_now" ||
      session.pricing === "late_finding" ||
      session.pricing === "paraphrased")
  );
}

/** Greeting wording occupies Now only before identity is established. */
export function greetingWordingOnNow(session: OccupancySession): boolean {
  if (session.greetingLocked) return false;
  if (session.auth || session.identityStatus === "VALID") return false;
  if (session.greeting !== "due_now" && session.greeting !== "paraphrased") {
    return false;
  }
  return Boolean(
    session.disclosures?.some(
      (d) => d.requirementId === "DEMO-GREETING-v1" && d.verbatimText,
    ),
  );
}

export function closingWordingOnNow(session: OccupancySession): boolean {
  return (
    session.closing === "due_now" ||
    session.closing === "paraphrased" ||
    session.closing === "unable_to_verify"
  );
}

/** Any required statement currently occupies Now: greeting, pricing, or closing. */
export function requiredWordingOnNow(session: OccupancySession): boolean {
  return (
    greetingWordingOnNow(session) ||
    requiredPricingOnNow(session) ||
    closingWordingOnNow(session)
  );
}

type ClarifySession = Pick<
  SessionState,
  "consent" | "nowCard"
>;

/**
 * Neutral consent clarification owns Now over pending NBA / objection tips.
 * Any member, any call — as long as the clarification body is the card on Now.
 */
export function clarificationHoldsNow(session: ClarifySession): boolean {
  const body = (session.nowCard.body ?? "").trim();
  const clarify = (session.consent.clarification ?? "").trim();
  if (!body || !clarify) return false;
  if (body === clarify) return true;
  return /clarify comparison interest/i.test(session.nowCard.title ?? "");
}
