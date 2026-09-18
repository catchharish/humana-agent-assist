import { isExactReading } from "@/lib/exactness";
import { appendJsonl } from "@/lib/log";
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

export const TRIGGER_CODES = [
  "prospective_estimate",
  "historical_amount",
  "service_choice",
  "none",
] as const;

export type TriggerCode = (typeof TRIGGER_CODES)[number];

const TRIGGER_STATIC = `Output exactly one code then stop: prospective_estimate|historical_amount|service_choice|none
Rules:
- Future fill cost spoken as an estimate → prospective_estimate
- Completed past charges / amounts already paid → historical_amount
- Optional 90-day / delivery / pharmacy-service choice (not a price) → service_choice
- Else none
Do not fire prospective_estimate on past paid charges.`;

export let triggerHedge = true;

export function setTriggerHedge(on: boolean) {
  triggerHedge = on;
}

function parseTriggerCode(text: string): TriggerCode | null {
  const t = text.trim().toLowerCase();
  if (t.startsWith("prospective_estimate")) return "prospective_estimate";
  if (t.startsWith("historical_amount")) return "historical_amount";
  if (t.startsWith("service_choice")) return "service_choice";
  if (/^none\b/.test(t) || t === "none") return "none";
  return null;
}

async function oneTriggerCall(
  session: SessionState,
  utterance: { text: string; stability: string },
): Promise<{
  code: TriggerCode | null;
  ms: number;
  ttftMs: number | null;
  ok: boolean;
  text: string;
}> {
  const { lunaStream } = await import("@/lib/openai");
  const hist = session.needs.some(
    (n) => n.kind === "historical_price" && n.status !== "resolved",
  );
  const prosp = needIsProspective(session);
  let code: TriggerCode | null = null;
  const streamed = await lunaStream({
    input: `${TRIGGER_STATIC}\n\nhistOpen:${hist ? 1 : 0} prospOpen:${prosp ? 1 : 0} stab:${utterance.stability}\n${JSON.stringify(utterance.text)}`,
    maxOutputTokens: 24,
    serviceTier: "priority",
    onDelta: (acc) => {
      code = parseTriggerCode(acc);
      return Boolean(code);
    },
  });
  if (!code) code = parseTriggerCode(streamed.text);
  return {
    code,
    ms: streamed.ms,
    ttftMs: streamed.ttftMs,
    ok: streamed.ok,
    text: streamed.text,
  };
}

export async function classifyLunaTrigger(
  session: SessionState,
  utterance: { speaker: string; text: string; stability: string },
): Promise<TriggerResult & { ttftMs: number | null; hedgeMs?: number[] }> {
  if (utterance.speaker !== "advocate") {
    return {
      stage: 0,
      fired: false,
      classification: "none",
      latencyMs: 0,
      modelCall: false,
      reason: "member_or_other_speaker",
      ttftMs: null,
    };
  }
  const t0 = performance.now();
  const runOne = () => oneTriggerCall(session, utterance);
  let first: Awaited<ReturnType<typeof oneTriggerCall>>;
  let hedgeMs: number[] | undefined;
  if (triggerHedge) {
    const p1 = runOne();
    const p2 = runOne();
    first = await Promise.race([p1, p2]);
    void Promise.all([p1, p2]).then((both) => {
      appendJsonl(session.sessionId, {
        kind: "luna_trigger_hedge",
        ms: both.map((x) => x.ms),
        codes: both.map((x) => x.code),
        winnerMs: first.ms,
      });
    });
  } else {
    first = await runOne();
  }
  const code = first.code ?? "none";
  const fired = code === "prospective_estimate";
  return {
    stage: 2,
    fired,
    classification: code,
    latencyMs: performance.now() - t0,
    modelCall: true,
    reason: `luna_stream:${first.code ?? "empty"}:${first.text?.slice(0, 80) ?? ""}`,
    ttftMs: first.ttftMs,
    hedgeMs,
  };
}
