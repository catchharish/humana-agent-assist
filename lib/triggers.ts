import { isExactReading } from "@/lib/exactness";
import type { DisclosureRequirement, SessionState } from "@/lib/types";

const AMOUNT_DIGIT = /(?:\$\s*)?\d+(?:\.\d+)?/;
const AMOUNT_WORD =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?\b/i;

export function hasAmount(text: string): boolean {
  return AMOUNT_DIGIT.test(text) || AMOUNT_WORD.test(text);
}

function pricingReq(session: SessionState): DisclosureRequirement | undefined {
  return session.disclosures.find((d) => d.requirementId === "DEMO-PRICING-v1");
}

function futureCues(session: SessionState): string[] {
  const patterns = pricingReq(session)?.triggerPatterns as
    | { futureEstimateCues?: string[] }
    | undefined;
  return patterns?.futureEstimateCues ?? [];
}

function hasFutureCue(text: string, cues: string[]): boolean {
  const lower = text.toLowerCase();
  return cues.some((c) => lower.includes(c.toLowerCase()));
}

function needIsProspective(session: SessionState): boolean {
  return (
    session.currentNeed === "prospective comparison" ||
    session.needs.some(
      (n) => n.kind === "prospective_comparison" && n.status !== "resolved",
    )
  );
}

export type TriggerResult = {
  stage: 1 | 2 | 0;
  fired: boolean;
  classification: string;
  latencyMs: number;
  modelCall: boolean;
  reason: string;
};

/**
 * Two-stage pricing trigger (PLAN item 7 / contract §15 DEMO-PRICING-v1).
 * Stage 1 never fires on historical-charge speech.
 */
export async function classifyPricingTrigger(
  session: SessionState,
  utterance: { speaker: string; text: string; stability: string },
): Promise<TriggerResult> {
  if (utterance.speaker !== "advocate") {
    return {
      stage: 0,
      fired: false,
      classification: "none",
      latencyMs: 0,
      modelCall: false,
      reason: "member_or_other_speaker",
    };
  }
  const cues = futureCues(session);
  const req = pricingReq(session);
  if (req && isExactReading(utterance.text, req.verbatimText)) {
    return {
      stage: 1,
      fired: false,
      classification: "none",
      latencyMs: 0,
      modelCall: false,
      reason: "exact_requirement_reading",
    };
  }
  const amount = hasAmount(utterance.text);
  const cue = hasFutureCue(utterance.text, cues);
  const prospective = needIsProspective(session);
  const historicalNeed = session.needs.some(
    (n) => n.kind === "historical_price" && n.status !== "resolved",
  );

  if (amount && cue && prospective) {
    return {
      stage: 1,
      fired: true,
      classification: "prospective_estimate",
      latencyMs: 0,
      modelCall: false,
      reason: "stage1_all_three_hold",
    };
  }

  const ambiguous =
    (amount && !cue) ||
    (amount && historicalNeed && !prospective) ||
    (!amount &&
      /cheaper|half|less than|more than|versus|compared/i.test(utterance.text));

  if (!ambiguous) {
    return {
      stage: 1,
      fired: false,
      classification: "none",
      latencyMs: 0,
      modelCall: false,
      reason: "stage1_silent",
    };
  }

  return {
    stage: 1,
    fired: false,
    classification: "none",
    latencyMs: 0,
    modelCall: false,
    reason: "ambiguous_deferred_to_utterance_interpret",
  };
}
