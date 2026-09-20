import { isExactReading } from "@/lib/exactness";
import { appendJsonl } from "@/lib/log";
import type { DisclosureRequirement, SessionState } from "@/lib/types";

const CURRENCY_MARKED = /\$\s*\d+(?:\.\d+)?/;
const NUMBER_THEN_MONEY =
  /\d+(?:\.\d+)?\s*(?:dollars?|bucks?|cents?)\b/i;
const WORD_THEN_MONEY =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?\s+(?:dollars?|bucks?|cents?)\b/i;

/** Currency-marked number, or a number followed by dollars/bucks/cents. Never day/month/quantity. */
export function hasAmount(text: string): boolean {
  return (
    CURRENCY_MARKED.test(text) ||
    NUMBER_THEN_MONEY.test(text) ||
    WORD_THEN_MONEY.test(text)
  );
}

function pricingReq(session: SessionState): DisclosureRequirement | undefined {
  return session.disclosures.find((d) => d.requirementId === "DEMO-PRICING-v1");
}

function pricingPatterns(session: SessionState) {
  return (pricingReq(session)?.triggerPatterns ?? {}) as {
    futureEstimateCues?: string[];
    comparativePatterns?: string[];
    namedOptionComparativeExamples?: string[];
    namedPharmacies?: string[];
    namedDrugs?: string[];
  };
}

function closingReq(session: SessionState): DisclosureRequirement | undefined {
  return session.disclosures.find((d) => d.requirementId === "DEMO-CLOSING-v2");
}

export function closingAttemptCues(session: SessionState): string[] {
  const p = closingReq(session)?.triggerPatterns as
    | { closingAttemptCues?: string[]; discussionCues?: string[] }
    | undefined;
  return [...(p?.closingAttemptCues ?? []), ...(p?.discussionCues ?? [])];
}

function futureCues(session: SessionState): string[] {
  return pricingPatterns(session).futureEstimateCues ?? [];
}

function comparativePatterns(session: SessionState): string[] {
  const p = pricingPatterns(session);
  return [
    ...(p.comparativePatterns ?? []),
    ...(p.namedOptionComparativeExamples ?? []),
  ];
}

function hasFutureCue(text: string, cues: string[]): boolean {
  const lower = text.toLowerCase();
  return cues.some((c) => lower.includes(c.toLowerCase()));
}

function hasComparative(text: string, session: SessionState): boolean {
  const lower = text.toLowerCase();
  return comparativePatterns(session).some((c) =>
    lower.includes(c.toLowerCase()),
  );
}

function quotedNames(session: SessionState): string[] {
  return session.quotes
    .flatMap((q) => [q.pharmacyName, q.drugName])
    .filter(Boolean);
}

export function namesQuotedOption(session: SessionState, text: string): boolean {
  const lower = text.toLowerCase();
  const names = [
    ...quotedNames(session),
    ...(session.prefetch?.prescriptions ?? []).map((p) => p.drugName),
  ].filter(Boolean);
  return names.some((n) => {
    const ln = n.toLowerCase();
    if (lower.includes(ln)) return true;
    return ln.split(/[\s/-]+/).some((w) => w.length > 3 && lower.includes(w));
  });
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
  const named = namesQuotedOption(session, utterance.text);
  const comparative = hasComparative(utterance.text, session);
  const prospective = needIsProspective(session);
  const historicalNeed = session.needs.some(
    (n) => n.kind === "historical_price" && n.status !== "resolved",
  );

  if (amount && cue && named && !historicalNeed) {
    return {
      stage: 1,
      fired: true,
      classification: "prospective_estimate",
      latencyMs: 0,
      modelCall: false,
      reason: "stage1_spoken_estimate",
    };
  }

  if (amount && cue && prospective && named) {
    return {
      stage: 1,
      fired: true,
      classification: "prospective_estimate",
      latencyMs: 0,
      modelCall: false,
      reason: "stage1_all_hold",
    };
  }

  const ambiguous =
    (amount && !cue) ||
    (amount && historicalNeed && !prospective) ||
    comparative ||
    (named && prospective && !amount) ||
    (named && !amount && comparative);

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
Do not fire prospective_estimate on past paid charges.
${"One code only. Stop. prospective_estimate historical_amount service_choice none. ".repeat(40)}`;

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
  httpStatus: number;
  error: string | null;
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
    promptCacheKey: "haa-trigger-v2",
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
    httpStatus: streamed.httpStatus,
    error: streamed.error,
  };
}

export async function classifyLunaTrigger(
  session: SessionState,
  utterance: { speaker: string; text: string; stability: string },
): Promise<TriggerResult & { ttftMs: number | null; hedgeMs?: number[]; httpStatus?: number; error?: string | null }> {
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
  let classification: string = "none";
  let fired = false;
  let hedgeMs: number[] | undefined;
  let firstText = "";
  let ttftMs: number | null = null;
  let winnerCode: TriggerCode | null = null;
  let httpStatus: number | undefined;
  let error: string | null | undefined;
  try {
    if (triggerHedge) {
      const p1 = runOne();
      const p2 = runOne();
      const both = await Promise.allSettled([p1, p2]);
      const legs = both
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runOne>>> => r.status === "fulfilled")
        .map((r) => r.value);
      hedgeMs = legs.map((x) => x.ms);
      const parsed = legs.filter((x) => x.code);
      if (parsed.length === 0) {
        classification = "unable_to_verify";
        winnerCode = null;
      } else if (parsed.some((x) => x.code === "prospective_estimate")) {
        winnerCode = "prospective_estimate";
        fired = true;
        classification = "prospective_estimate";
      } else {
        winnerCode = parsed[0].code;
        classification = parsed[0].code ?? "none";
      }
      firstText = parsed[0]?.text ?? legs[0]?.text ?? "";
      ttftMs = parsed[0]?.ttftMs ?? legs[0]?.ttftMs ?? null;
      const fail = legs.find((x) => !x.ok) ?? legs[0];
      httpStatus = fail?.httpStatus;
      error = fail?.error;
      appendJsonl(session.sessionId, {
        kind: "luna_trigger_hedge",
        ms: hedgeMs,
        codes: legs.map((x) => x.code),
        httpStatus: legs.map((x) => x.httpStatus),
        error: legs.map((x) => x.error),
      });
    } else {
      const first = await runOne();
      winnerCode = first.code;
      classification = first.code ?? "unable_to_verify";
      fired = first.code === "prospective_estimate";
      firstText = first.text;
      ttftMs = first.ttftMs;
      httpStatus = first.httpStatus;
      error = first.error;
      if (!first.code) classification = "unable_to_verify";
    }
  } catch {
    classification = "unable_to_verify";
  }
  return {
    stage: 2,
    fired,
    classification,
    latencyMs: performance.now() - t0,
    modelCall: true,
    reason: `luna_stream:${winnerCode ?? "empty"}:${firstText.slice(0, 80)}`,
    ttftMs,
    hedgeMs,
    httpStatus,
    error,
  };
}
