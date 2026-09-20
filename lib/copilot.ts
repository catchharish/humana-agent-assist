import { invalidateSessionTokens, normalizeScopeKey } from "@/lib/enrollmentToken";
import { interpretUtterance, finalCompatibleWithPartial, type Interpretation } from "@/lib/interpret";
import { terraComplete, parseJsonObject } from "@/lib/openai";
import { runAnswerLoop, retrievedFingerprint } from "@/lib/answerLoop";
import { supportCheck } from "@/lib/supportCheck";
import { proposeNba, logNbaAdvocate } from "@/lib/nba";
import { fetchMemberQuotes } from "@/lib/quotesFetch";
import { publishSession } from "@/lib/sse";
import { appendJsonl } from "@/lib/log";
import {
  CLARIFY_INTEREST,
  NUDGE_CLOSING,
  NUDGE_PARAPHRASE,
  NUDGE_PRICING,
  clarifyInterest,
  enrollmentReadback,
} from "@/lib/copy";
import { isExactReading, isWordingAttempt, stitchedReading, wordDiff } from "@/lib/exactness";
import {
  beginAnswerLoop,
  getNeed,
  recordActionResult,
  pushRouterTrace,
  pushTriggerTrace,
  requiredPricingOnNow,
  setFocus,
  showNow,
  upsertNeed,
} from "@/lib/session";
import {
  classifyComparisonConsent,
  classifyEnrollmentConsent,
  isDirectNamedQuoteAsk,
  isNinetyDayQuestion,
  matchesAll,
  matchesAny,
  namedMedicationsInText,
} from "@/lib/utteranceRules";
import type { NeedKind, SessionState } from "@/lib/types";
import { classifyLunaTrigger, classifyPricingTrigger, closingAttemptCues } from "@/lib/triggers";

const historicalJobs = new Map<string, string>();

function answerLoopBase(session: SessionState, origin: string, question: string) {
  return {
    origin,
    memberId: session.member?.memberId ?? session.selectedMemberId,
    planId: session.member?.planId ?? "DEMO-MAPD-001",
    authId: session.auth?.authorizationId ?? "DEMO-AUTH001",
    question,
    loadedSnapshot: true,
    shortAnswers: true,
    serviceTier: "priority" as const,
    nbaParallel: true,
    clockStart: performance.now(),
    generation: 0,
    session,
    identityVerified: session.identityStatus === "VALID",
    dueNow:
      session.pricing === "due_now" ||
      session.pricing === "late_finding" ||
      session.pricing === "paraphrased",
    preload: false,
    preloadSearchOnly: true,
    searchDelayMs: session.injectedDelayMs || undefined,
    overlay: session.overlay,
    comparisonConsentYes: session.consent.comparison === "absolute_yes",
  };
}

async function runMemberQuestionLoop(
  session: SessionState,
  origin: string,
  question: string,
  needKind?: NeedKind,
  sourceUtteranceId?: string,
) {
  if (!question.trim()) return;
  const owned = sourceUtteranceId
    ? session.needs.find((n) => n.sourceUtteranceId === sourceUtteranceId)
    : undefined;
  const kind = owned?.kind ?? needKind;
  try {
    if (kind && !getNeed(session, kind)?.queryText) {
      upsertNeed(session, kind, {
        queryText: question,
        sourceUtteranceId: sourceUtteranceId ?? getNeed(session, kind)?.sourceUtteranceId,
      });
    }
    const generation = beginAnswerLoop(
      session,
      question,
      kind,
      sourceUtteranceId,
    );
    await runAnswerLoop({
      ...answerLoopBase(session, origin, question),
      generation,
      paintNow: true,
      needKind: kind,
      sourceUtteranceId,
    });
  } catch (err) {
    appendJsonl(session.sessionId, {
      kind: "answer_loop_error",
      need: kind ?? "member_question",
      error: String(err),
    });
  }
}

export async function resumeParkedNeed(
  session: SessionState,
  origin: string,
  kind: NeedKind,
) {
  const need = getNeed(session, kind);
  const queryText = need?.queryText;
  if (!queryText) {
    setFocus(session, kind, need?.flowStep ?? "advocate-selected focus");
    if (need?.answer) {
      showNow(session, {
        title: need.answer.title,
        body: need.answer.body,
        sourceLabel: need.answer.sourceLabel,
        statements: need.answer.statements,
      }, { priority: "answer", needKind: kind });
    }
    return;
  }
  const prevFp = need?.fingerprint ?? "";
  upsertNeed(session, kind, {
    status: "active",
    guidance: "preparing",
    flowStep: "recheck dependencies → explain or preserve gap",
  });
  setFocus(session, kind, "recheck dependencies → explain or preserve gap");
  try {
    const generation = beginAnswerLoop(
      session,
      queryText,
      kind,
      need?.sourceUtteranceId,
    );
    const result = await runAnswerLoop({
      ...answerLoopBase(session, origin, queryText),
      generation,
      paintNow: true,
      needKind: kind,
      routerRecheck: true,
      sourceUtteranceId: need?.sourceUtteranceId,
    });
    const fp = retrievedFingerprint(result.retrieved ?? []);
    const changed = Boolean(prevFp && prevFp !== fp);
    session.diagnostics.rechecks.push({
      at: new Date().toISOString(),
      fingerprint: fp,
      changed,
    });
    pushRouterTrace(session, {
      routesUsed: result.toolsUsed,
      latencyMs: Math.round(result.totalMs),
      retrieved: (result.retrieved ?? []).map((s) => ({
        id: s.id,
        sourceSystem: s.sourceTag,
      })),
      rejected: [],
      recheck: true,
    });
    appendJsonl(session.sessionId, {
      kind: "answer_recheck",
      needKind: kind,
      previousFingerprint: prevFp,
      fingerprint: fp,
      changed,
    });
  } catch (err) {
    appendJsonl(session.sessionId, {
      kind: "answer_loop_error",
      need: kind,
      error: String(err),
    });
  }
}

export async function promoteHistorical(
  session: SessionState,
  origin: string,
) {
  await resumeParkedNeed(session, origin, "historical_price");
}

export async function retryLastAnswer(session: SessionState, origin: string) {
  const q = session.lastAnswerQuestion;
  if (!q) return;
  await runMemberQuestionLoop(session, origin, q);
}

async function paintLoopNeed(
  session: SessionState,
  kind: Parameters<typeof upsertNeed>[1],
  title: string,
  result: Awaited<ReturnType<typeof runAnswerLoop>>,
  flowStep: string,
) {
  upsertNeed(session, kind, {
    status: result.supportPartial ? "unresolved_gap" : "resolved",
    guidance: "ready",
    flowStep,
    answer: {
      title,
      body: result.answer,
      sourceLabel: result.sources.join(" · ") || "System record · simulated",
    },
    fingerprint: result.answer.slice(0, 200),
  });
}

export let testInterpretFactory: ((
  session: SessionState,
  line: { id: string; speaker: string; text: string; stability: string },
) => Promise<Interpretation>) | null = null;

export let testDelayApply: { eventId: string; ms: number } | null = null;
export let testDelayTrigger: { eventId: string; ms: number } | null = null;
export let testTriggerResult: {
  fired: boolean;
  classification: string;
  stage: 1 | 2 | 0;
  modelCall: boolean;
  reason: string;
  latencyMs: number;
  ttftMs: number | null;
} | null = null;

const appliedLunaTriggers = new Set<string>();

export function setLunaTestHooks(opts: {
  interpret?: typeof testInterpretFactory;
  delayApply?: typeof testDelayApply;
  delayTrigger?: typeof testDelayTrigger;
  triggerResult?: typeof testTriggerResult;
}) {
  if ("interpret" in opts) testInterpretFactory = opts.interpret ?? null;
  if ("delayApply" in opts) testDelayApply = opts.delayApply ?? null;
  if ("delayTrigger" in opts) testDelayTrigger = opts.delayTrigger ?? null;
  if ("triggerResult" in opts) testTriggerResult = opts.triggerResult ?? null;
}

export function resetLunaTestHooks() {
  testInterpretFactory = null;
  testDelayApply = null;
  testDelayTrigger = null;
  testTriggerResult = null;
}

function consentAnchorOf(session: SessionState) {
  const lastAdv =
    [...session.transcript]
      .reverse()
      .find(
        (t) =>
          t.speaker === "advocate" &&
          (t.stability === "final" || t.stability === "corrected"),
      )?.text ?? "";
  return `${session.consent.clarification ?? ""}||${lastAdv}`;
}

function logFieldDiscard(
  session: SessionState,
  eventId: string,
  field: "consent" | "focus" | "callType" | "election",
) {
  appendJsonl(session.sessionId, {
    kind: "luna_stale_discard",
    field,
    eventId,
  });
}

const partialJobs = new Map<
  string,
  { text: string; promise: Promise<Interpretation> }
>();

const scriptMarks = new Map<
  string,
  { nudgeOffsetMs?: number; paraphraseOffsetMs?: number }
>();

function mailPharmacyName(session: SessionState) {
  const q = session.quotes.find(
    (x) =>
      x.pharmacyId === "centerwell" ||
      /mail|centerwell/i.test(x.pharmacyName),
  );
  return q?.pharmacyName || "mail pharmacy";
}

function pickupPharmacyName(session: SessionState) {
  const refill = session.prefetch?.refill as
    | { pharmacyName?: string; provider?: { organizationName?: string } }
    | null
    | undefined;
  return (
    refill?.pharmacyName ||
    refill?.provider?.organizationName ||
    "the recorded pharmacy"
  );
}

function joinMedicineNames(session: SessionState) {
  const names = [
    ...new Set(session.quotes.map((q) => q.drugName).filter(Boolean)),
  ];
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function sessionEnrollmentReadback(session: SessionState) {
  const delivery = session.enrollment.medications;
  const quoted = [
    ...new Set(session.quotes.map((q) => q.drugName).filter(Boolean)),
  ];
  const retail = quoted.filter(
    (d) => !delivery.some((x) => x.toLowerCase() === d.toLowerCase()),
  );
  return enrollmentReadback({
    serviceName:
      session.prefetch?.serviceGuide?.displayName || "the recorded pharmacy service",
    deliveryMedications: delivery,
    retailMedications: retail,
    pickupPharmacy: pickupPharmacyName(session),
  });
}

export function setEnrollmentMedications(
  session: SessionState,
  medications: string[],
) {
  if (session.enrollment.submitted) return;
  const nextKey = normalizeScopeKey(medications);
  const prevKey = normalizeScopeKey(session.enrollment.medications);
  if (nextKey !== prevKey) {
    invalidateSessionTokens(session.sessionId);
    session.consent.enrollment = "none";
    session.consent.enrollmentScopeKey = null;
    session.consent.enrollmentUtteranceId = null;
    session.enrollment.confirmed = false;
    session.enrollment.scopeChangedAt = Date.now();
  }
  session.enrollment.medications = medications;
  session.enrollment.readback = sessionEnrollmentReadback(session);
}

function lastAdvocateFinal(session: SessionState) {
  return [...session.transcript]
    .reverse()
    .find(
      (t) =>
        t.speaker === "advocate" &&
        (t.stability === "final" || t.stability === "corrected"),
    );
}

function lastAdvocateIsCurrentReadback(session: SessionState): boolean {
  const last = lastAdvocateFinal(session);
  if (!last || !session.enrollment.readback.trim()) return false;
  return (
    isExactReading(last.text, session.enrollment.readback) ||
    isWordingAttempt(last.text, session.enrollment.readback, 0.7)
  );
}

function waitingNeedMatchingUtterance(
  session: SessionState,
  text: string,
): NeedKind | undefined {
  const t = text.toLowerCase();
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount > 10) return undefined;
  const returnCue =
    /\b(so,? the|what about (that|those)|those amounts|that price|back to (that|it|the))\b/.test(
      t,
    );
  for (const n of session.needs) {
    if (n.status !== "deferred" && n.guidance !== "deferred_valid") continue;
    if (!n.queryText) continue;
    const vocab = n.queryText
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4);
    const named = namedMedicationsInText(text, [
      ...sessionQuoteEntities(session).drugs,
      ...vocab,
    ]);
    const mentionsParked = named.some((d) =>
      n.queryText!.toLowerCase().includes(d.toLowerCase()),
    );
    if (returnCue || mentionsParked) return n.kind;
  }
  return undefined;
}

function sessionQuoteEntities(session: SessionState) {
  const drugs = [
    ...new Set(
      [
        ...(session.prefetch?.prescriptions ?? []).map((p) => p.drugName),
        ...session.quotes.map((q) => q.drugName),
        ...session.enrollment.medications,
      ].filter(Boolean),
    ),
  ];
  const refillName = String(
    (session.prefetch?.refill as { pharmacyName?: string } | null)?.pharmacyName ??
      "",
  );
  const pharmacies = [
    ...new Set(
      [...session.quotes.map((q) => q.pharmacyName), refillName].filter(Boolean),
    ),
  ];
  return { drugs, pharmacies };
}

function pharmacyIdFromUtterance(session: SessionState, text: string) {
  const lower = text.toLowerCase();
  const denied = /(?:not|no longer|instead of)\s+([a-z][a-z\s]{2,20})/i.exec(
    text,
  );
  const deniedBlob = (denied?.[1] ?? "").toLowerCase();
  const hits = session.quotes.filter((q) => {
    if (!q.pharmacyId) return false;
    const name = q.pharmacyName.toLowerCase();
    const words = name.split(/\s+/).filter((w) => w.length > 3);
    const mentioned =
      lower.includes(name) || words.some((w) => lower.includes(w));
    if (!mentioned) return false;
    if (deniedBlob && (deniedBlob.includes(words[0] ?? "") || name.includes(deniedBlob.trim()))) {
      return false;
    }
    return true;
  });
  if (hits[0]?.pharmacyId) return hits[0].pharmacyId;
  const refillName = String(
    (session.prefetch?.refill as { pharmacyName?: string } | null)?.pharmacyName ??
      "",
  ).toLowerCase();
  if (
    refillName &&
    wordsMatch(lower, refillName) &&
    !deniedBlob.includes(refillName.split(/\s+/)[0] ?? "")
  ) {
    if (/lakeview/.test(refillName) || /lakeview/.test(lower)) return "lakeview";
  }
  if (session.quotes.length > 0) {
    if (/oak street/.test(lower) && !/not oak/.test(lower)) return "oak-street";
    if (/centerwell/.test(lower) && !/not centerwell/.test(lower))
      return "centerwell";
  }
  return undefined;
}

function wordsMatch(text: string, name: string) {
  if (text.includes(name)) return true;
  return name.split(/\s+/).some((w) => w.length > 3 && text.includes(w));
}

function showClarifyOnce(
  session: SessionState,
  title: string,
  body: string,
) {
  session.consent.clarification = body;
  if (!session.consent.clarificationShown) {
    session.consent.clarificationShown = true;
  }
  if (requiredPricingOnNow(session)) {
    paintPricingNow(session);
    return;
  }
  showNow(
    session,
    {
      title,
      body,
      sourceLabel: "Governed guidance · scripting · simulated",
    },
    { priority: "nudge" },
  );
}

function wrapEvidenceLine(session: SessionState) {
  const fresh = String(session.prefetch?.refillFresh?.fillStatus ?? "");
  const needBody = getNeed(session, "refill_status")?.answer?.body ?? "";
  const blob = `${fresh} ${needBody}`;
  const fillStatus = /ready/i.test(blob)
    ? "ready"
    : /pending|submitted|processing|received/i.test(blob)
      ? fresh || "pending"
      : fresh || needBody.slice(0, 80);
  return [
    session.enrollment.resultId,
    session.enrollment.medications.join(", "),
    fillStatus,
    session.coverage?.caseId,
  ]
    .filter(Boolean)
    .join(" · ");
}

function readbackPending(session: SessionState): boolean {
  if (!session.enrollment.readback.trim()) return false;
  const after = session.enrollment.scopeChangedAt;
  return session.transcript.some(
    (t) =>
      t.speaker === "advocate" &&
      (t.stability === "final" || t.stability === "corrected") &&
      t.receivedAt >= after &&
      (isExactReading(t.text, session.enrollment.readback) ||
        isWordingAttempt(t.text, session.enrollment.readback, 0.7)),
  );
}

function memberConsentLine(
  line: { speaker: string; stability: string },
) {
  return (
    line.speaker === "member" &&
    (line.stability === "final" || line.stability === "corrected")
  );
}

function limitationCard(title: string, body: string) {
  return {
    title,
    body,
    sourceLabel: "Governed guidance · scripting · simulated",
  };
}

function recordNeedPath(
  session: SessionState,
  eventId: string | undefined,
  need: string,
  path: "code_rule" | "luna",
) {
  const rec = { eventId: eventId ?? "", need, path };
  session.diagnostics.needPaths = [...session.diagnostics.needPaths, rec];
  appendJsonl(session.sessionId, { kind: "need_path", ...rec });
}

function presentHistorical(
  session: SessionState,
  routed: { evidence: { causeSupported?: boolean; chargesEstablished?: boolean } },
  drafted: {
    title: string;
    body: string;
    sourceLabel: string;
    statements?: import("@/lib/citations").CitedStatement[];
  },
  origin?: string,
) {
  const focusIsHistorical =
    session.currentNeed === "historical price" ||
    session.currentNeed === "historical_price";
  if (focusIsHistorical) {
    upsertNeed(session, "historical_price", {
      status: routed.evidence.causeSupported ? "resolved" : "unresolved_gap",
      guidance: "ready",
      flowStep: routed.evidence.causeSupported
        ? "identify matching purchases → retrieve applied policy/evidence → explain"
        : "identify matching purchases → retrieve applied policy/evidence → preserve gap",
    });
    showNow(session, {
      title: drafted.title,
      body: drafted.body,
      sourceLabel: drafted.sourceLabel,
      statements: drafted.statements,
    }, { priority: "answer", needKind: "historical_price" });
    if (origin) void proposeNba(session, origin, drafted.title + " " + drafted.body);
  } else {
    upsertNeed(session, "historical_price", {
      status: "deferred",
      guidance: "deferred_valid",
      flowStep:
        "identify matching purchases → retrieve applied policy/evidence → deferred (valid)",
    });
  }
}

async function runHistorical(
  session: SessionState,
  origin: string,
  queryText: string,
  opts: { injectedDelayMs: number; recheck: boolean },
) {
  const memberId = session.member?.memberId;
  const planId = session.member?.planId;
  if (!memberId || !planId) return;
  if (!queryText.trim()) {
    showNow(session, {
      title: "Need clarification",
      body: "No query text is stored for this historical-price need. Withholding retrieval rather than inventing a question.",
      sourceLabel: "Governed guidance · scripting · simulated",
    });
    return;
  }
  try {
    const result = await runAnswerLoop({
      ...answerLoopBase(session, origin, queryText),
      searchDelayMs: opts.injectedDelayMs || session.injectedDelayMs || undefined,
      paintNow: false,
      routerRecheck: opts.recheck,
    });
  const cause = historicalCauseFromPrefetch(session);
  const fp = result.answer;
  const prev = getNeed(session, "historical_price");
  if (opts.recheck && prev?.fingerprint === fp && prev.answer) {
    session.diagnostics.rechecks.push({
      at: new Date().toISOString(),
      fingerprint: fp,
      changed: false,
    });
    presentHistorical(session, {
      evidence: cause,
    }, {
      title: prev.answer.title,
      body: prev.answer.body,
      sourceLabel: prev.answer.sourceLabel,
    }, origin);
    publishSession(session);
    return;
  }
  if (opts.recheck) {
    session.diagnostics.rechecks.push({
      at: new Date().toISOString(),
      fingerprint: fp,
      changed: Boolean(prev?.fingerprint && prev.fingerprint !== fp),
    });
  }
  upsertNeed(session, "historical_price", {
    fingerprint: fp,
    answer: {
      title: result.supportPartial ? "Partial answer" : "Completed charges",
      body: result.answer,
      sourceLabel: result.sources.join(" · ") || "Claims",
      causeSupported: cause.causeSupported,
      chargesEstablished: cause.chargesEstablished,
      statements: result.statements,
    },
  });
  session.retrievedSources = result.retrieved ?? session.retrievedSources;
  presentHistorical(
    session,
    {
      evidence: {
        causeSupported: cause.causeSupported,
        chargesEstablished: cause.chargesEstablished,
      },
    },
    {
      title: result.supportPartial ? "Partial answer" : "Completed charges",
      body: result.answer,
      sourceLabel: result.sources.join(" · ") || "Claims",
      statements: result.statements,
    },
    origin,
  );
  publishSession(session);
  } catch (err) {
    appendJsonl(session.sessionId, {
      kind: "answer_loop_error",
      need: "historical_price",
      error: String(err),
    });
  }
}

function historicalCauseFromPrefetch(session: SessionState) {
  const claims = (session.prefetch?.claims ?? []) as Array<{
    claimId?: string;
    dateOfService?: string;
    drugName?: string;
    memberPaidAmount?: { value?: string };
    pharmacy?: { pharmacyId?: string };
  }>;
  const classes = (session.prefetch?.classifications ?? []) as Array<{
    pharmacyId?: string;
    asOfDate?: string;
  }>;
  const chargesEstablished = claims.some(
    (c) => Boolean(c.memberPaidAmount?.value) && Boolean(c.drugName),
  );
  const unmatched = claims.filter(
    (c) =>
      !classes.find(
        (r) =>
          (!c.pharmacy?.pharmacyId || r.pharmacyId === c.pharmacy.pharmacyId) &&
          (!c.dateOfService || r.asOfDate === c.dateOfService),
      ),
  );
  return {
    chargesEstablished,
    causeSupported: chargesEstablished && unmatched.length === 0,
  };
}

function pricingRequirement(session: SessionState) {
  return session.disclosures.find((d) => d.requirementId === "DEMO-PRICING-v1");
}

function markExactPricingDelivery(
  session: SessionState,
  line: { id?: string; offsetMs?: number },
) {
  session.pricingExactDelivered = true;
  if (line.offsetMs != null) session.pricingExactOffset = line.offsetMs;
  session.nowPriority = 0;
  session.nudge = null;
  const marks = scriptMarks.get(session.sessionId) ?? {};
  const nudgeOffsetMs = marks.nudgeOffsetMs;
  const callMs =
    nudgeOffsetMs != null && line.offsetMs != null
      ? line.offsetMs - nudgeOffsetMs
      : null;
  appendJsonl(session.sessionId, {
    kind: "pricing_nudge_to_exact_call",
    exactEventId: line.id ?? null,
    exactOffsetMs: line.offsetMs ?? null,
    nudgeOffsetMs: nudgeOffsetMs ?? null,
    paraphraseOffsetMs: marks.paraphraseOffsetMs ?? null,
    callMs,
    clock: "stream_offsetMs",
  });
}

function assessPricingSpeech(
  session: SessionState,
  line: { id: string; text: string; offsetMs?: number },
) {
  const req = pricingRequirement(session);
  if (!req) return;
  const heard = stitchedReading(
    session.transcript,
    {
      id: line.id,
      speaker: "advocate",
      stability: "final",
      text: line.text,
    },
    req.verbatimText,
  );
  const exact = isExactReading(heard, req.verbatimText);
  if (exact) {
    markExactPricingDelivery(session, line);
    const alreadyLate = session.estimateSpokenWithoutReading || session.pricing === "late_finding";
    if (alreadyLate) {
      session.pricing = "late_finding";
      session.pricingNote = "Delivered correctly, but late.";
    } else {
      session.pricing = "exact_timely";
      session.pricingNote = null;
    }
    if (session.quotes.length > 0) {
      paintQuotesAttention(session);
    }
    return;
  }
  if (session.pricingExactDelivered) return;
  if (session.pricing === "due_now" || session.pricing === "late_finding") {
    const cueAttempt =
      Boolean(session.nudge) &&
      /\b(price|prices|estimate|change)\b/i.test(heard);
    if (!isWordingAttempt(heard, req.verbatimText) && !cueAttempt) return;
    const diff = wordDiff(heard, req.verbatimText);
    if (diff.missingFromHeard.length > 0 || diff.extraInHeard.length > 0) {
      session.pricing = session.estimateSpokenWithoutReading
        ? "late_finding"
        : "paraphrased";
      session.nudge = {
        template: NUDGE_PARAPHRASE,
        heard,
        requiredText: req.verbatimText,
        missingFromHeard: diff.missingFromHeard,
        extraInHeard: diff.extraInHeard,
      };
      const marks = scriptMarks.get(session.sessionId) ?? {};
      marks.paraphraseOffsetMs = line.offsetMs;
      scriptMarks.set(session.sessionId, marks);
      appendJsonl(session.sessionId, {
        kind: "pricing_paraphrase_rejected",
        eventId: line.id,
        offsetMs: line.offsetMs ?? null,
        heard: line.text,
        requiredText: req.verbatimText,
        missingFromHeard: diff.missingFromHeard,
        extraInHeard: diff.extraInHeard,
      });
    }
  }
}

function mapQuotes(
  session: SessionState,
  rows: Array<Record<string, unknown>>,
) {
  const expected = session.quoteFocus?.pharmacyId;
  return rows.map((q) => {
    const pharmacyId = String(q.pharmacyId ?? "");
    const drugName = String(q.drugName ?? "");
    const stale =
      Boolean(expected) && Boolean(pharmacyId) && pharmacyId !== expected;
    return {
      quoteId: String(q.quoteId),
      drugName,
      pharmacyId,
      pharmacyName: String(q.pharmacyName ?? ""),
      estimatedMemberCost: (q.estimatedMemberCost as {
        value: string;
        currency: string;
      }) ?? { value: "", currency: "USD" },
      daysSupply: Number(q.daysSupply ?? 90),
      quantity: Number(q.quantity ?? 0),
      validityStatus: stale
        ? "invalidated"
        : String(q.validityStatus ?? "valid"),
    };
  });
}

function mergeQuotes(
  session: SessionState,
  incoming: ReturnType<typeof mapQuotes>,
) {
  const byId = new Map(session.quotes.map((q) => [q.quoteId, q]));
  for (const q of incoming) byId.set(q.quoteId, q);
  session.quotes = [...byId.values()];
}

function applyFocusInvalidation(session: SessionState) {
  const expected = session.quoteFocus?.pharmacyId;
  if (!expected) return;
  for (const q of session.quotes) {
    if (q.pharmacyId && q.pharmacyId !== expected) {
      q.validityStatus = "invalidated";
    }
  }
}

function quoteNowBody(session: SessionState) {
  const valid = session.quotes.filter((q) => q.validityStatus === "valid");
  const stale = session.quotes.filter((q) => q.validityStatus === "invalidated");
  const lines = valid.map(
    (q) =>
      `${q.drugName} at ${q.pharmacyName}: $${q.estimatedMemberCost.value} (${q.daysSupply}-day estimate)`,
  );
  const staleNote = stale.length
    ? ` Invalidated (do not relabel): ${stale
        .map(
          (q) =>
            `${q.drugName} ${q.pharmacyName} $${q.estimatedMemberCost.value}`,
        )
        .join("; ")}.`
    : "";
  return (
    (lines.join(". ") || "Matching 90-day estimates are on this card.") +
    staleNote
  );
}

function markPricingUpcoming(session: SessionState) {
  if (session.pricing === "not_applicable") {
    session.pricing = "pending_later";
  }
}

function paintPricingNow(session: SessionState) {
  const req = pricingRequirement(session);
  showNow(
    session,
    {
      title: "Pricing statement due now",
      body: req?.verbatimText ?? "",
      sourceLabel: "Governed guidance · scripting · simulated",
    },
    { priority: "due_now" },
  );
}

function demoteQuotesNeed(session: SessionState) {
  const amountsOk = session.consent.comparison === "absolute_yes";
  const due = requiredPricingOnNow(session);
  const body = amountsOk
    ? `${quoteNowBody(session)} No universal cheapest or guaranteed savings.`
    : "Comparison quotes are ready. Estimates stay off the Now card until comparison interest is an absolute yes.";
  upsertNeed(session, "prospective_comparison", {
    status: "active",
    guidance: "ready",
    flowStep: due
      ? "compare estimates · ready, demoted"
      : "educate → confirm interest → compare estimates",
    answer: {
      title: "Prospective comparison",
      body,
      sourceLabel: "System record · pharmacy · simulated",
    },
  });
}

function paintQuotesAttention(session: SessionState) {
  if (session.quotes.length > 0 || getNeed(session, "prospective_comparison")) {
    demoteQuotesNeed(session);
  }
  if (requiredPricingOnNow(session)) {
    paintPricingNow(session);
    return;
  }
  const amountsOk = session.consent.comparison === "absolute_yes";
  if (amountsOk && session.pricingExactDelivered && session.quotes.length > 0) {
    showNow(
      session,
      {
        title: "Prospective comparison",
        body: `${quoteNowBody(session)} No universal cheapest or guaranteed savings.`,
        sourceLabel: "System record · pharmacy · simulated",
      },
      { priority: "answer", needKind: "prospective_comparison" },
    );
  }
}

function markPricingDueFromConsent(session: SessionState) {
  if (session.pricingExactDelivered) return;
  if (
    session.pricing === "not_applicable" ||
    session.pricing === "pending_later"
  ) {
    session.pricing = "due_now";
  }
}

async function settleComparisonYes(
  session: SessionState,
  origin: string,
  lineId?: string,
  path?: "code_rule" | "luna",
) {
  session.consent.comparison = "absolute_yes";
  session.consent.clarification = null;
  session.consent.clarificationShown = false;
  markPricingDueFromConsent(session);
  if (session.quotes.length === 0) {
    await loadQuotes(session, origin);
    if (lineId && path) {
      recordNeedPath(session, lineId, "prospective_comparison", path);
    }
  } else {
    paintQuotesAttention(session);
  }
}

export async function loadQuotes(
  session: SessionState,
  origin: string,
  opts?: {
    pharmacyId?: string;
    delayMs?: number;
    generation?: number;
    updateFocus?: boolean;
  },
) {
  const memberId = session.member?.memberId ?? "";
  const pharmacyId = opts?.pharmacyId ?? session.quoteFocus?.pharmacyId;
  const generation = opts?.generation ?? session.quoteGeneration;
  const got = await fetchMemberQuotes({
    origin,
    authId: session.auth?.authorizationId ?? "",
    memberId,
    pharmacyId,
    overlay: session.overlay,
  });
  appendJsonl(session.sessionId, {
    kind: "getQuotes",
    via: "code_on_consent",
    latencyMs: got.ms,
    quoteCount: got.quotes.length,
  });
  const mapped = mapQuotes(session, got.quotes);
  if (generation !== session.quoteGeneration) {
    for (const q of mapped) {
      if (
        session.quoteFocus?.pharmacyId &&
        q.pharmacyId &&
        q.pharmacyId !== session.quoteFocus.pharmacyId
      ) {
        q.validityStatus = "invalidated";
      }
    }
  }
  mergeQuotes(session, mapped);
  applyFocusInvalidation(session);
  if (session.consent.comparison === "absolute_yes") {
    markPricingDueFromConsent(session);
  } else {
    markPricingUpcoming(session);
  }
  if (opts?.updateFocus !== false) {
    setFocus(
      session,
      "prospective_comparison",
      "confirm interest → compare estimates",
    );
  }
  paintQuotesAttention(session);
}

function requestQuotes(
  session: SessionState,
  origin: string,
  pharmacyId: string | undefined,
  drug: string | undefined,
  updateFocus = true,
) {
  session.quoteGeneration += 1;
  const generation = session.quoteGeneration;
  if (pharmacyId) {
    session.quoteFocus = {
      drug: drug || session.quoteFocus?.drug || "requested",
      pharmacyId,
    };
  }
  return loadQuotes(session, origin, { pharmacyId, generation, updateFocus });
}

export async function loadFast90(
  session: SessionState,
  origin: string,
  updateFocus = true,
) {
  void origin;
  const pre = session.prefetch?.fast90;
  const art = pre ?? null;
  if (art) {
    pushRouterTrace(session, {
      routesUsed: ["knowledge_search"],
      latencyMs: 0,
      retrieved: [{ id: art.articleId, sourceSystem: "scripting" }],
      rejected: [],
      ranked: [],
      injectedDelayMs: 0,
    });
  }
  upsertNeed(session, "service_education", {
    status: "active",
    guidance: "ready",
    flowStep: "educate (derived DEMO-FAST90-v1)",
    answer: {
      title: "90-day option",
      body: art?.body || "Derived 90-day guidance unavailable.",
      sourceLabel: `Derived from source/version · scripting · simulated (${art?.articleId} ← ${art?.lineageSourceId})`,
    },
  });
  if (updateFocus) {
    setFocus(session, "service_education", "educate → confirm interest");
  }
  showNow(session, {
    title: "90-day option",
    body: art?.body || "Derived 90-day guidance unavailable.",
    sourceLabel: `Derived from source/version · scripting · simulated (${art?.articleId} ← ${art?.lineageSourceId})`,
  }, { priority: "answer", needKind: "service_education" });
}

function markServiceDiscussed(session: SessionState) {
  session.serviceDiscussed = true;
  session.callType = "Education / enrollment";
  if (session.closing === "not_applicable") {
    session.closing = "pending_later";
  }
}

export function applyHumanOffer(session: SessionState) {
  if (!session.recommendation) return;
  session.recommendation.status = "offered";
  logNbaAdvocate(session, "offer");
  if (session.recommendation.marksPricingUpcoming) {
    markPricingUpcoming(session);
  }
}

export function applyHumanDismiss(session: SessionState) {
  if (!session.recommendation) return;
  session.recommendation.status = "dismissed";
  session.nbaDismissedThisCall = true;
  logNbaAdvocate(session, "dismiss");
}

export function applyHumanObjection(session: SessionState) {
  const body =
    session.prefetch?.objection?.body ||
    "Governed objection article was not retrieved. Do not improvise a persuasion script.";
  const articleId = session.prefetch?.objection?.articleId ?? "DEMO-OBJECTION-RETAIL-v1";
  session.recommendation = {
    kind: "objection_retail",
    title: "Governed hesitation response",
    body,
    sourceLabel: `Governed guidance · scripting · simulated (${articleId})`,
    status: "used",
  };
  showNow(session, {
    title: "Governed hesitation response",
    body,
    sourceLabel: `Governed guidance · scripting · simulated (${articleId})`,
  }, { priority: "answer" });
}

export function applyHumanEditEnrollmentScope(
  session: SessionState,
  medications: string[],
) {
  setEnrollmentMedications(session, medications);
  showNow(session, {
    title: "Enrollment scope changed — confirmation invalidated",
    body: session.enrollment.readback,
    sourceLabel: "Governed guidance · scripting · simulated",
  });
}

export function applyHumanWithdrawEnrollment(session: SessionState) {
  invalidateSessionTokens(session.sessionId);
  session.enrollment.withdrawn = true;
  session.enrollment.confirmed = false;
  session.consent.enrollment = "none";
  showNow(session, {
    title: "Enrollment withdrawn",
    body: "Withdrawal blocks the pending submission. No business action is claimed. Other needs and already applicable closing remain.",
    sourceLabel: "Governed guidance · scripting · simulated",
  });
}

async function maybeCompleteServicing(session: SessionState) {
  if (session.coverage) return;
  if (session.disposition.recommended) return;
  if (session.enrollment.submitted) return;
  if (getNeed(session, "historical_price")) return;
  if (getNeed(session, "coverage_status")) return;
  if (getNeed(session, "prospective_comparison")) return;
  const election = getNeed(session, "service_election");
  if (election && !session.enrollment.withdrawn) return;
  const unanswered = session.needs.some(
    (n) =>
      (n.kind === "unrecognized_request" || n.kind === "unsupported_work") &&
      n.status !== "resolved",
  );
  if (unanswered) return;
  const refillDone = getNeed(session, "refill_status")?.status === "resolved";
  const educationClosed =
    session.serviceDiscussed && session.closing === "exact_timely";
  if (!refillDone && !educationClosed) return;
  session.disposition.recommended = "COMPLETED_SERVICING";
  if (!session.wrapStable) {
    void draftWrapStable(session);
  }
}

function closingRequirement(session: SessionState) {
  return session.disclosures.find((d) => d.requirementId === "DEMO-CLOSING-v2");
}

function looksLikeClosing(session: SessionState, text: string) {
  const cues = closingAttemptCues(session);
  const lower = text.toLowerCase();
  return cues.some((c) => lower.includes(c.toLowerCase()));
}

async function draftWrapStable(session: SessionState) {
  const terra = await terraComplete(
    `Write a concise wrap note of completed servicing so far. JSON only: {"wrap":string}
Rules: use only Evidence. Do not state a transfer connection, specialist connected, or final disposition. Those have not returned. Do not invent pickup, approval, or coverage determination.
Evidence:
${JSON.stringify({
  needs: session.needs.map((n) => ({
    kind: n.kind,
    question: n.queryText ?? null,
    answer: n.answer
      ? {
          body: n.answer.body,
          sourceLabel: n.answer.sourceLabel,
        }
      : null,
  })),
  actions: session.actionResults.map((a) => ({
    kind: a.kind,
    body: a.body,
    sourceLabel: a.sourceLabel,
  })),
  refillFresh: session.prefetch?.refillFresh,
  enrollment: session.enrollment,
  coverage: session.coverage,
  pricing: session.pricing,
  closing: session.closing,
  optionalWorkSuppressed: session.optionalWorkSuppressed,
})}
Each wrap sentence must come from one need's current answer or one action result, and name that source.`,
    500,
  );
  const parsed = parseJsonObject<{ wrap?: string }>(terra.text);
  appendJsonl(session.sessionId, {
    kind: "terra_complete",
    task: "wrap",
    ok: terra.ok,
    ms: terra.ms,
    usage: terra.usage ?? null,
    httpStatus: terra.httpStatus,
    error: terra.error,
  });
  session.wrapStable =
    parsed?.wrap ??
    (terra.ok ? terra.text : "Wrap draft unavailable. Use a labeled manual template.");
  if (!session.transfer.connectionStatus) {
    session.wrapDraft = session.wrapStable;
  }
  const wrapRetrieved = [
    ...session.retrievedSources,
    {
      id: "session-evidence",
      kind: "record" as const,
      sourceTag: "Pharmacy system",
      text: JSON.stringify({
        refill: getNeed(session, "refill_status")?.answer ?? session.prefetch?.refill,
        enrollment: session.enrollment,
        coverage: session.coverage,
      }),
    },
    ...session.transcript.map((t) => ({
      id: t.id,
      kind: "transcript" as const,
      sourceTag: "Transcript",
      text: t.text,
    })),
  ];
  session.retrievedSources = wrapRetrieved;
  const wrapCheck = supportCheck({
    question: "wrap",
    answer: session.wrapDraft,
    retrieved: wrapRetrieved,
    toolsUsed: [],
    snapshotHasPlanRule: false,
    sources: wrapRetrieved.map((s) => s.id),
  });
  session.wrapLines = wrapCheck.statements;
  session.diagnostics.supportCheckMs =
    (session.diagnostics.supportCheckMs ?? 0) + wrapCheck.ms;
  publishSession(session);
}

function fillWrapOutcome(session: SessionState) {
  const caseId = session.coverage?.caseId;
  const status = session.coverage?.status;
  const outcome = session.transfer.connectionStatus
    ? `Connection result: ${session.transfer.transferId ?? "unassigned"} — ${session.transfer.connectionStatus}. ${caseId ? `${caseId} remains ${status ?? "unreturned"}` : "No coverage case is on the session"}. Connection is not a coverage determination.`
    : "No connection result has returned; do not state a transfer outcome.";
  session.wrapDraft = [session.wrapStable, outcome, wrapEvidenceLine(session)]
    .filter(Boolean)
    .join("\n\n");
  session.outcomeReady = true;
}

function assessClosing(
  session: SessionState,
  line: { id?: string; text: string; stability: string },
) {
  if (line.stability === "partial") return;
  if (session.closing === "not_applicable") return;
  const req = closingRequirement(session);
  if (!req) return;
  if (session.closingLocked) return;
  const heard = stitchedReading(
    session.transcript,
    {
      id: line.id ?? "",
      speaker: "advocate",
      stability: line.stability,
      text: line.text,
    },
    req.verbatimText,
  );
  if (line.stability === "uncertain" && looksLikeClosing(session, line.text)) {
    session.closing = "unable_to_verify";
    session.closingNote = "Uncertain first attempt preserved. Ask for a clear reread.";
    session.closingHistory.push({
      text: line.text,
      stability: "uncertain",
      assessment: "unable_to_verify",
    });
    session.nudge = {
      template: NUDGE_CLOSING,
      heard: line.text,
      requiredText: req.verbatimText,
    };
    showNow(session, {
      title: "Closing could not be verified",
      body: req.verbatimText,
      sourceLabel: "Governed guidance · scripting · simulated",
    }, { priority: "nudge" });
    return;
  }
  if (
    (line.stability === "final" || line.stability === "corrected") &&
    isExactReading(heard, req.verbatimText)
  ) {
    session.nudge =
      session.nudge?.template === NUDGE_CLOSING ? null : session.nudge;
    session.closing = "exact_timely";
    session.closingLocked = true;
    session.closingNote = session.closingHistory.some(
      (h) => h.assessment === "unable_to_verify",
    )
      ? "Uncertain first attempt preserved. Later reread verified."
      : null;
    session.closingHistory.push({
      text: line.text,
      stability: line.stability,
      assessment: "exact_timely",
    });
    void draftWrapStable(session);
    return;
  }
  if (
    (line.stability === "final" || line.stability === "corrected") &&
    looksLikeClosing(session, heard) &&
    isWordingAttempt(heard, req.verbatimText)
  ) {
    session.closing = "paraphrased";
    session.nudge = {
      template: NUDGE_CLOSING,
      heard: line.text,
      requiredText: req.verbatimText,
    };
  }
}

export async function loadCoverage(
  session: SessionState,
  origin: string,
  updateFocus = true,
  sourceUtteranceId?: string,
  drugName?: string,
) {
  const q = new URLSearchParams({
    memberId: session.member?.memberId ?? "",
  });
  if (drugName) q.set("drug", drugName);
  const headers: Record<string, string> = {
    "x-authorization-id": session.auth?.authorizationId ?? "",
  };
  if (session.overlay) headers["x-demo-overlay"] = session.overlay;
  const row = await fetch(
    `${origin}/api/simulated/coverage-review/cases?${q.toString()}`,
    { cache: "no-store", headers },
  );
  const json = (await row.json()) as {
    data?: {
      cases?: Array<{
        caseId?: string;
        status?: string;
        requestedMedication?: string;
        determination?: string | null;
      }>;
    };
  };
  const data = json.data?.cases?.[0];
  if (!row.ok || !data || !data.caseId || !data.status) {
    showNow(
      session,
      limitationCard(
        "Coverage lookup limitation",
        "No coverage case was returned for this member and medication.",
      ),
      { priority: "answer", needKind: "coverage_status" },
    );
    return;
  }
  const c = {
    caseId: String(data.caseId),
    status: String(data.status),
    requestedMedication: String(data.requestedMedication ?? ""),
    determination:
      data.determination === null || data.determination === undefined
        ? null
        : String(data.determination),
  };
  session.coverage = c;
  upsertNeed(session, "coverage_status", {
    status: "active",
    guidance: "ready",
    flowStep: "check case → recommend destination",
    sourceUtteranceId,
  });
  if (updateFocus) {
    setFocus(session, "coverage_status", "check case → recommend destination");
  }
  const pending = c.status.toLowerCase() === "pending_review";
  showNow(session, {
    title: "Coverage case status (read only)",
    body: pending
      ? `The request is still under review; this record does not show an approval yet. ${c.caseId}: ${c.requestedMedication}, status ${c.status}. Pending is not denied. This role cannot make a determination.`
      : `${c.caseId} status ${c.status}. No determination is being made here.`,
    sourceLabel: "System record · coverage-review · simulated",
  }, { priority: "answer", needKind: "coverage_status" });
  await proposeNba(
    session,
    origin,
    `Coverage case ${c.caseId} status ${c.status} for ${c.requestedMedication}. What should the advocate do next?`,
  );
}

async function draftHandoff(session: SessionState) {
  const terra = await terraComplete(
    `Draft a short advocate-to-Coverage-Review handoff. JSON only: {"handoff":string}
Rules: use only Evidence. Include member/case reference, requested medication and status from Evidence.coverage, what the member asked, what was checked, enrollment result if present, today's retail pickup restriction from Evidence.refill. No approval, no promised service time, no full transcript. Connection has not occurred.
Evidence:
${JSON.stringify({
  member: session.member,
  coverage: session.coverage,
  enrollment: session.enrollment,
  refill: getNeed(session, "refill_status")?.answer ?? session.prefetch?.refill,
})}`,
    500,
  );
  const parsed = parseJsonObject<{ handoff?: string }>(terra.text);
  session.handoffDraft =
    parsed?.handoff ??
    (terra.ok
      ? terra.text
      : `Handoff draft unavailable. The coverage case remains pending review.`);
  const handRetrieved = [
    ...session.retrievedSources,
    {
      id: "coverage-status",
      kind: "record" as const,
      sourceTag: "Coverage review",
      text: JSON.stringify(session.coverage ?? {}),
    },
  ];
  const handCheck = supportCheck({
    question: "handoff",
    answer: session.handoffDraft,
    retrieved: handRetrieved,
    toolsUsed: [],
    snapshotHasPlanRule: false,
    sources: handRetrieved.map((s) => s.id),
  });
  session.handoffLines = handCheck.statements;
}

export async function confirmTransferDestination(session: SessionState) {
  session.transfer.destinationConfirmed = true;
  if (session.recommendation?.kind === "warm_transfer") {
    session.recommendation.status = "offered";
  }
  if (session.closing === "pending_later") session.closing = "due_now";
  upsertNeed(session, "coverage_status", {
    flowStep: "human confirm → connect (not yet connected)",
  });
  await draftHandoff(session);
  showNow(session, {
    title: "Handoff draft — not a connection",
    body: session.handoffDraft,
    sourceLabel: "Governed guidance · scripting · simulated",
  });
}

export async function executeTransfer(session: SessionState, origin: string) {
  if (!session.transfer.destinationConfirmed) {
    return { error: "destination_not_confirmed" as const };
  }
  if (session.closing !== "exact_timely") {
    return { error: "closing_not_verified" as const };
  }
  const resp = await fetch(`${origin}/api/simulated/telephony/transfers`, {
    method: "POST",
    cache: "no-store",
    headers: session.overlay
      ? { "x-demo-overlay": session.overlay }
      : undefined,
  });
  const json = (await resp.json()) as {
    data?: {
      transferId?: string;
      connectionStatus?: string;
      destinationQueue?: string;
    };
  };
  if (!resp.ok || !json.data?.connectionStatus) {
    showNow(
      session,
      limitationCard(
        "Transfer limitation",
        `Telephony did not return a connection status (HTTP ${resp.status}). No connected transfer is claimed.`,
      ),
    );
    return { error: "telephony_no_status" as const };
  }
  const status = json.data.connectionStatus;
  session.transfer.transferId = json.data.transferId ?? null;
  session.transfer.connectionStatus = status;
  const connected = /connected/i.test(status);
  const pending = /pending/i.test(status);
  const failed = /fail/i.test(status);
  if (connected) {
    session.disposition.recommended = "TRANSFERRED_COVERAGE_REVIEW";
  } else if (pending) {
    session.disposition.recommended = null;
  } else if (failed) {
    session.disposition.recommended = null;
  }
  upsertNeed(session, "coverage_status", {
    status: connected ? "unresolved_gap" : "unresolved_gap",
    flowStep: connected
      ? "connected — case still pending"
      : pending
        ? "telephony pending — not connected"
        : "telephony failed — not connected",
  });
  const wrapWait = draftWrapStable(session);
  await Promise.race([
    wrapWait,
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  if (!session.wrapStable) {
    session.wrapStable =
      "Wrap draft unavailable (timeout). Labeled manual template: record completed work from the session evidence; do not invent a connection.";
  }
  fillWrapOutcome(session);
  const connBody = `${session.transfer.transferId ?? "unassigned"}: ${status}. ${
    session.coverage
      ? `${session.coverage.caseId} remains ${session.coverage.status}`
      : "No coverage case is on the session"
  }. Connection is not a coverage determination.`;
  recordActionResult(session, {
    kind: "transfer_connect",
    title: "Connection result",
    body: connBody,
    sourceLabel: "System record · telephony · simulated",
    at: new Date().toISOString(),
  });
  showNow(session, {
    title: "Connection result",
    body: connBody,
    sourceLabel: "System record · telephony · simulated",
  });
  return { ok: true as const };
}

export function confirmDisposition(session: SessionState, code: string): { ok: boolean; reason?: string } {
  if (code === "TRANSFERRED_COVERAGE_REVIEW") {
    if (!session.transfer.connectionStatus || !/connected/i.test(session.transfer.connectionStatus)) {
      return { ok: false, reason: "not_connected" };
    }
    session.disposition.confirmed = code;
    return { ok: true };
  }
  if (code === "COMPLETED_SERVICING") {
    if (
      session.needs.some(
        (n) =>
          (n.kind === "unrecognized_request" || n.kind === "unsupported_work") &&
          n.status !== "resolved",
      )
    ) {
      return { ok: false, reason: "unanswered_work" };
    }
    session.disposition.confirmed = code;
    return { ok: true };
  }
  if (!session.transfer.connectionStatus) return { ok: false, reason: "no_connection_status" };
  session.disposition.confirmed = code;
  return { ok: true };
}

export function saveWrap(session: SessionState, wrap: string) {
  session.wrapDraft = wrap;
}

export function flagIssue(session: SessionState, note: string) {
  session.flaggedIssues = [
    ...session.flaggedIssues,
    { at: new Date().toISOString(), note },
  ];
  appendJsonl(session.sessionId, { kind: "issue_flagged", note });
}

export function viewEvidence(session: SessionState, sourceId?: string) {
  if (sourceId) {
    const st = [
      ...(session.nowCard.statements ?? []),
      ...(session.wrapLines ?? []),
      ...(session.handoffLines ?? []),
    ].find((s) => s.sourceId === sourceId);
    const retrieved = session.retrievedSources.find((s) => s.id === sourceId);
    const playbook = session.recommendation?.playbookPassage;
    session.openEvidence = {
      title: retrieved?.id || st?.sourceTag || "Opened record",
      body: retrieved?.text || playbook || session.nowCard.body,
      sourceLabel: retrieved
        ? `${retrieved.sourceTag}`
        : (st?.sourceTag ?? session.nowCard.sourceLabel),
      highlight: st?.highlight ?? sourceId,
    };
  } else {
    session.openEvidence = {
      title: session.nowCard.title,
      body: session.nowCard.body,
      sourceLabel: session.nowCard.sourceLabel,
    };
  }
  appendJsonl(session.sessionId, {
    kind: "evidence_opened",
    title: session.openEvidence.title,
    sourceLabel: session.openEvidence.sourceLabel,
    sourceId: sourceId ?? null,
  });
}

function applyPricingTriggerResult(
  session: SessionState,
  line: {
    id: string;
    speaker: string;
    stability: string;
    text: string;
    offsetMs?: number;
  },
  trigger: {
    stage: 1 | 2 | 0;
    fired: boolean;
    classification: string;
    latencyMs: number;
    modelCall: boolean;
    reason: string;
  },
) {
  const key = `${session.sessionId}:${line.id}`;
  if (appliedLunaTriggers.has(key) && trigger.modelCall) return;
  if (trigger.modelCall) appliedLunaTriggers.add(key);
  const exactOff = session.pricingExactOffset;
  const lineOff = line.offsetMs;
  const suppressRepeat = Boolean(
    trigger.fired &&
      exactOff != null &&
      lineOff != null &&
      lineOff >= exactOff,
  );
  pushTriggerTrace(session, {
    at: line.id,
    stage: trigger.stage,
    fired: trigger.fired,
    classification: trigger.classification,
    latencyMs: trigger.latencyMs,
    modelCall: trigger.modelCall,
    reason: suppressRepeat
      ? "repetition_rule_after_exact_delivery"
      : trigger.reason,
    suppressed: suppressRepeat,
  });
  if (trigger.fired && !suppressRepeat) {
    session.estimateSpokenWithoutReading = true;
    if (
      session.needs.some(
        (n) => n.kind === "prospective_comparison" && n.status !== "resolved",
      ) ||
      session.consent.comparison === "absolute_yes"
    ) {
      session.pricing = "late_finding";
      session.nudge = { template: NUDGE_PRICING };
      if (!session.pricingNote) {
        session.pricingNote = "Deadline crossed without a qualifying reading.";
      }
      const marks = scriptMarks.get(session.sessionId) ?? {};
      if (marks.nudgeOffsetMs == null && line.offsetMs != null) {
        marks.nudgeOffsetMs = line.offsetMs;
        scriptMarks.set(session.sessionId, marks);
      }
    } else if (
      session.pricing === "not_applicable" ||
      session.pricing === "pending_later"
    ) {
      session.pricing = "due_now";
    }
    paintQuotesAttention(session);
  }
  if (line.stability === "final" || line.stability === "corrected") {
    if (!trigger.fired || suppressRepeat) assessPricingSpeech(session, line);
  }
  assessClosing(session, line);
}

export async function applyAdvocateObligations(
  session: SessionState,
  line: {
    id: string;
    speaker: string;
    stability: string;
    text: string;
    offsetMs?: number;
  },
): Promise<void> {
  if (line.speaker !== "advocate") return;
  const saidAt =
    session.transcript.find((t) => t.id === line.id)?.receivedAt ?? Date.now();
  const stamped = {
    ...line,
    offsetMs: line.offsetMs ?? saidAt,
  };
  const triggerCode = await classifyPricingTrigger(session, line);
  if (triggerCode.reason === "ambiguous_deferred_to_utterance_interpret") {
    void (async () => {
      try {
        if (
          testDelayTrigger &&
          testDelayTrigger.eventId === line.id &&
          testDelayTrigger.ms > 0
        ) {
          await new Promise((r) => setTimeout(r, testDelayTrigger!.ms));
        }
        const luna = testTriggerResult
          ? { ...testTriggerResult }
          : await classifyLunaTrigger(session, line);
        appendJsonl(session.sessionId, {
          kind: "luna_trigger",
          eventId: line.id,
          ms: luna.latencyMs,
          ttftMs: luna.ttftMs,
          classification: luna.classification,
          fired: luna.fired,
          hedgeMs: "hedgeMs" in luna ? luna.hedgeMs : undefined,
          httpStatus: "httpStatus" in luna ? luna.httpStatus : undefined,
          error: "error" in luna ? luna.error : undefined,
          saidAt,
          offsetMs: stamped.offsetMs,
        });
        applyPricingTriggerResult(session, stamped, luna);
        publishSession(session);
      } catch {
        applyPricingTriggerResult(session, stamped, {
          stage: 2,
          fired: false,
          classification: "unable_to_verify",
          latencyMs: 0,
          modelCall: true,
          reason: "luna_trigger_error",
        });
        publishSession(session);
      }
    })();
    return;
  }
  applyPricingTriggerResult(session, stamped, triggerCode);
}

async function applyInterpretation(
  session: SessionState,
  origin: string,
  line: { id: string; speaker: string; stability: string; text: string },
  interp: Interpretation,
  commitConsent: boolean,
  policy: { seq: number; consentAnchor: string },
) {
  const isNewest = policy.seq === session.lunaSeq;
  const allowConsent = policy.consentAnchor === consentAnchorOf(session);
  const focus = (kind: Parameters<typeof setFocus>[1], step: string) => {
    if (!isNewest) {
      logFieldDiscard(session, line.id, "focus");
      return;
    }
    setFocus(session, kind, step);
  };
  const servicingFlags =
    interp.refillCheck !== "none" ||
    interp.historicalAsked ||
    interp.returnToHistorical ||
    interp.ninetyDayAsked ||
    interp.coverageAsked ||
    Boolean(interp.quotePharmacy) ||
    interp.firmRefusal ||
    interp.withdrawEnrollment ||
    interp.memberAgreesTransfer ||
    interp.electionMetforminOnly ||
    interp.enrollmentConsent !== "none" ||
    interp.comparisonConsent !== "none" ||
    interp.retailHesitation ||
    interp.serviceIntroducedByAdvocate;
  if (interp.smallTalkOnly && !servicingFlags) {
    return;
  }

  if (
    interp.callTypeChange &&
    interp.callTypeChange !== session.callType
  ) {
    if (!isNewest) {
      logFieldDiscard(session, line.id, "callType");
    } else {
      session.callType = interp.callTypeChange;
    }
  }

  const memberId = session.member?.memberId ?? "";
  const planId = session.member?.planId ?? "";
  void memberId;
  void planId;

  if (interp.refillCheck === "existing_request" && line.speaker === "member") {
    upsertNeed(session, "refill_status", {
      status: "active",
      guidance: "preparing",
      flowStep: "verify → check existing request",
      sourceUtteranceId: line.id,
    });
    focus("refill_status", "verify → check existing request");
  }

  if (interp.historicalAsked && line.speaker === "member") {
    const prior = getNeed(session, "historical_price");
    const histPatch: Parameters<typeof upsertNeed>[2] = {
      status: prior?.answer ? prior.status : "requested",
      guidance: prior?.answer ? prior.guidance : "preparing",
      flowStep: "identify matching purchases → retrieve applied policy/evidence",
      sourceUtteranceId: prior?.sourceUtteranceId ?? line.id,
    };
    if (!prior?.queryText) histPatch.queryText = line.text;
    upsertNeed(session, "historical_price", histPatch);
    if (interp.refillCheck === "none" && !interp.returnToHistorical) {
      focus(
        "historical_price",
        "identify matching purchases → retrieve applied policy/evidence",
      );
    }
  }

  if (interp.refillCheck === "current_readiness" && line.speaker === "member") {
    const hist = getNeed(session, "historical_price");
    if (hist) {
      upsertNeed(session, "historical_price", {
        status: "deferred",
        guidance:
          hist.guidance === "ready" || hist.answer
            ? "deferred_valid"
            : "preparing",
        flowStep:
          "identify matching purchases → retrieve applied policy/evidence → waiting",
      });
    }
    focus(
      "refill_status",
      "check existing request → explain status (fresh)",
    );
  }

  if (commitConsent && interp.communicatedRefillReadiness) {
    upsertNeed(session, "refill_status", {
      status: "resolved",
      flowStep: "explain status → wrap path",
    });
  }

  if (commitConsent && interp.returnToHistorical && getNeed(session, "historical_price")) {
    await resumeParkedNeed(session, origin, "historical_price");
  }

  if (interp.serviceIntroducedByAdvocate && line.speaker === "advocate") {
    markServiceDiscussed(session);
  }

  if (interp.ninetyDayAsked) {
    markServiceDiscussed(session);
    if (getNeed(session, "service_education")?.guidance !== "ready") {
      await loadFast90(session, origin, isNewest);
      recordNeedPath(session, line.id, "service_education", "luna");
    }
  }

  if (commitConsent && interp.retailHesitation && memberConsentLine(line) && !session.optionalWorkSuppressed) {
    const body =
      session.prefetch?.objection?.body ||
      "Governed objection article was not retrieved.";
    session.recommendation = {
      kind: "objection_retail",
      title: "Governed hesitation response",
      body,
      sourceLabel: "Governed guidance · scripting · simulated",
      status: "pending",
    };
  }

  if (
    commitConsent &&
    interp.firmRefusal &&
    memberConsentLine(line) &&
    matchesAny(session.utteranceRules?.firmRefusal, line.text)
  ) {
    session.optionalWorkSuppressed = true;
    session.recommendation = null;
    session.consent.comparison = "none";
    session.consent.enrollment = "none";
    showNow(session, {
      title: "Optional work stopped",
      body: "Member declined delivery and asked to keep retail. Stop comparison, enrollment, and repeated rebuttals. Today's pickup and any real open need stay. Closing remains applicable if the service was discussed. No inferred negative plan effect.",
      sourceLabel: "Governed guidance · scripting · simulated",
    });
  }

  const wantsConsent =
    interp.comparisonConsent !== "none" || interp.enrollmentConsent !== "none";
  if (!memberConsentLine(line)) {
    if (wantsConsent) logFieldDiscard(session, line.id, "consent");
  }
  if (commitConsent && wantsConsent && memberConsentLine(line) && !allowConsent) {
    logFieldDiscard(session, line.id, "consent");
    const lastAdv =
      [...session.transcript]
        .reverse()
        .find((t) => t.speaker === "advocate")?.text ?? "";
    const codeWait = classifyComparisonConsent({
      rules: session.utteranceRules,
      speaker: line.speaker,
      text: line.text,
      stability: line.stability,
      optionalWorkSuppressed: session.optionalWorkSuppressed,
      scopedPending: Boolean(session.consent.clarification) ||
        matchesAny(session.utteranceRules?.scopedComparisonAsk, lastAdv),
      lastAdvocate: lastAdv,
    });
    if (codeWait === "wait" && session.consent.comparison === "none") {
      const medicines =
        joinMedicineNames(session) || "your existing medicines";
      showClarifyOnce(
        session,
        "Clarify comparison interest",
        clarifyInterest({ medicines }),
      );
    }
  }
  const mayConsent = commitConsent && allowConsent && memberConsentLine(line);

  if (
    mayConsent &&
    interp.comparisonConsent === "hedge" &&
    !session.optionalWorkSuppressed
  ) {
    session.consent.comparison = "hedge";
    showClarifyOnce(session, "Clarify comparison interest", CLARIFY_INTEREST);
  }

  if (
    mayConsent &&
    interp.comparisonConsent === "absolute_yes" &&
    !session.optionalWorkSuppressed
  ) {
    const lastAdv =
      [...session.transcript]
        .reverse()
        .find((t) => t.speaker === "advocate")?.text ?? "";
    const code = classifyComparisonConsent({
      rules: session.utteranceRules,
      speaker: line.speaker,
      text: line.text,
      stability: line.stability,
      optionalWorkSuppressed: session.optionalWorkSuppressed,
      scopedPending: Boolean(session.consent.clarification) ||
        matchesAny(session.utteranceRules?.scopedComparisonAsk, lastAdv),
      lastAdvocate: lastAdv,
    });
    if (code === "hedge") {
      session.consent.comparison = "hedge";
      showClarifyOnce(session, "Clarify comparison interest", CLARIFY_INTEREST);
    } else if (code === "absolute_yes") {
      await settleComparisonYes(session, origin, line.id, "luna");
    } else if (code === "wait") {
      const scopedPending =
        Boolean(session.consent.clarification) ||
        matchesAny(session.utteranceRules?.scopedComparisonAsk, lastAdv);
      if (scopedPending) {
        await settleComparisonYes(session, origin, line.id, "luna");
      }
    }
  }

  if (
    (interp.quotePharmacy || interp.quotePharmacyCorrection) &&
    line.speaker === "member" &&
    !session.optionalWorkSuppressed
  ) {
    if (!interp.quotePharmacy) {
      showNow(session, {
        title: "Need clarification",
        body: "A pharmacy correction was heard but no known pharmacy id was identified. Withholding quotes.",
        sourceLabel: "Governed guidance · scripting · simulated",
      });
    } else {
      upsertNeed(session, "prospective_comparison", {
        status: "active",
        guidance: "preparing",
        flowStep: "compare estimates",
      });
      await requestQuotes(
        session,
        origin,
        interp.quotePharmacy,
        interp.quoteDrug ?? undefined,
        isNewest,
      );
    }
  }

  if (commitConsent && interp.electionMetforminOnly && memberConsentLine(line)) {
    if (!isNewest) {
      logFieldDiscard(session, line.id, "election");
      showNow(session, {
        title: "Need clarification",
        body: "A later utterance replaced this election result before it was applied. Re-confirm the scoped election.",
        sourceLabel: "Governed guidance · scripting · simulated",
      });
    } else {
      const meds = interp.electedMedications;
      if (meds.length === 0) {
        showNow(session, {
          title: "Need clarification",
          body: "A split retail/delivery election was heard but no medication names were identified. Withholding an enrollment draft.",
          sourceLabel: "Governed guidance · scripting · simulated",
        });
      } else {
        upsertNeed(session, "service_election", {
          status: "active",
          guidance: "ready",
          flowStep: "enroll/decline — scoped election",
          sourceUtteranceId: line.id,
        });
        focus("service_election", "enroll/decline — scoped election");
        setEnrollmentMedications(session, meds);
        showNow(session, {
          title: "Enrollment draft — scoped",
          body: session.enrollment.readback,
          sourceLabel: "Governed guidance · scripting · simulated",
        });
      }
    }
  }

  if (
    mayConsent &&
    interp.enrollmentConsent === "hedge" &&
    lastAdvocateIsCurrentReadback(session) &&
    !session.enrollment.resultId
  ) {
    session.consent.enrollment = "hedge";
    showClarifyOnce(
      session,
      "Clarify enrollment",
      "To confirm: do you want to submit the enrollment we just read back?",
    );
  }

  if (
    mayConsent &&
    interp.enrollmentConsent === "absolute_yes" &&
    !session.enrollment.withdrawn &&
    !session.enrollment.resultId &&
    lastAdvocateIsCurrentReadback(session)
  ) {
    const decision = classifyEnrollmentConsent({
      rules: session.utteranceRules,
      speaker: line.speaker,
      text: line.text,
      stability: line.stability,
      draftMedications: session.enrollment.medications,
      readback: session.enrollment.readback,
      readbackPending: readbackPending(session),
    });
    if (decision === "absolute_yes") {
      session.consent.enrollment = "absolute_yes";
      session.consent.enrollmentScopeKey = normalizeScopeKey(
        session.enrollment.medications,
      );
      session.consent.enrollmentUtteranceId = line.id;
      session.consent.clarification = null;
      session.consent.clarificationShown = false;
    } else if (decision === "hedge" || decision === "clarify") {
      session.consent.enrollment = "hedge";
      showClarifyOnce(
        session,
        "Clarify enrollment",
        "To confirm: do you want to submit the enrollment we just read back?",
      );
    }
  }

  if (
    commitConsent &&
    interp.withdrawEnrollment &&
    memberConsentLine(line) &&
    matchesAny(session.utteranceRules?.withdraw, line.text)
  ) {
    applyHumanWithdrawEnrollment(session);
  }

  if (interp.coverageAsked) {
    const drug = namedMedicationsInText(line.text, [
      ...sessionQuoteEntities(session).drugs,
      session.coverage?.requestedMedication ?? "",
    ])[0];
    upsertNeed(session, "coverage_status", {
      status: "requested",
      guidance: "preparing",
      flowStep: "check case → recommend destination",
      sourceUtteranceId: line.id,
      queryText: drug || line.text,
    });
    if (isNewest) {
      setFocus(session, "coverage_status", "check case → recommend destination");
    }
  }

  if (interp.advocateOfferedTransfer && session.coverage) {
    if (session.closing === "pending_later") session.closing = "due_now";
  }

  if (interp.memberAgreesTransfer && memberConsentLine(line) && session.coverage) {
    upsertNeed(session, "coverage_status", {
      flowStep: "member agreed → awaiting human destination confirm",
    });
  }

  if (interp.callTypeChange === "Do-not-call") {
    upsertNeed(session, "unsupported_work", {
      status: "unresolved_gap",
      guidance: "invalidated",
      flowStep: "unsupported request — no DNC workflow in this prototype",
      sourceUtteranceId: line.id,
    });
    showNow(
      session,
      limitationCard(
        "Unsupported work",
        "Do-not-call / list-removal is out of scope for this prototype. No fake DNC workflow is started.",
      ),
      { priority: "answer", needKind: "unsupported_work" },
    );
  }

  if (commitConsent) await maybeCompleteServicing(session);
}

export async function prefetchMemberRecords(
  session: SessionState,
  origin: string,
) {
  const memberId = session.member?.memberId;
  const planId = session.member?.planId;
  if (!memberId || !planId) return;
  const headers: Record<string, string> = {
    "x-authorization-id": session.auth?.authorizationId ?? "",
  };
  if (session.overlay) headers["x-demo-overlay"] = session.overlay;
  const [list, claims, net, fast, obj, svc, prefs] = await Promise.all([
    fetch(
      `${origin}/api/simulated/pharmacy/refill-requests?memberId=${encodeURIComponent(memberId)}`,
      { cache: "no-store", headers },
    ),
    fetch(
      `${origin}/api/simulated/claims/pharmacy?memberId=${encodeURIComponent(memberId)}`,
      { cache: "no-store", headers },
    ),
    fetch(
      `${origin}/api/simulated/benefits/plans/${planId}/pharmacy-network`,
      { cache: "no-store", headers },
    ),
    fetch(`${origin}/api/simulated/scripting/articles/DEMO-FAST90-v1`, {
      cache: "no-store",
    }),
    fetch(
      `${origin}/api/simulated/scripting/articles/DEMO-OBJECTION-RETAIL-v1`,
      { cache: "no-store" },
    ),
    fetch(`${origin}/api/simulated/scripting/articles/DEMO-SERVICE-v1`, {
      cache: "no-store",
    }),
    fetch(
      `${origin}/api/simulated/eligibility/members/${memberId}/contact-preferences`,
      { cache: "no-store", headers },
    ),
  ]);
  const listJson = list.ok
    ? ((await list.json()) as {
        data?: { requests?: Array<Record<string, unknown>> };
      })
    : { data: { requests: [] } };
  const refill = listJson.data?.requests?.[0] ?? null;
  let refillFresh: Record<string, unknown> | null = null;
  const rid = refill?.requestId ? String(refill.requestId) : "";
  if (rid) {
    const st = await fetch(
      `${origin}/api/simulated/pharmacy/refill-requests/${rid}/status`,
      { cache: "no-store", headers },
    );
    if (st.ok) {
      const stJson = (await st.json()) as { data?: Record<string, unknown> };
      refillFresh = stJson.data ?? null;
    }
  }
  const claimsJson = claims.ok
    ? ((await claims.json()) as { data?: { claims?: unknown[] } })
    : { data: { claims: [] } };
  const netJson = net.ok
    ? ((await net.json()) as { data?: { rows?: unknown[] } })
    : { data: { rows: [] } };
  const fastJson = fast.ok
    ? ((await fast.json()) as {
        data?: {
          articleId?: string;
          body?: string;
          lineageSourceId?: string | null;
          version?: string;
        };
      })
    : { data: {} };
  session.prefetch = {
    refill,
    refillFresh,
    claims: claimsJson.data?.claims ?? [],
    classifications: netJson.data?.rows ?? [],
    fast90: fastJson.data?.articleId
      ? {
          articleId: fastJson.data.articleId,
          body: String(fastJson.data.body ?? ""),
          lineageSourceId: fastJson.data.lineageSourceId ?? "DEMO-SERVICE-v1",
          version: fastJson.data.version,
        }
      : null,
    serviceGuide: null,
    objection: null,
    prescriptions: [],
    contactPreferences: null,
  };
  if (prefs.ok) {
    const prefsJson = (await prefs.json()) as {
      data?: { doNotContact?: boolean; mailServiceEnrolled?: boolean };
    };
    if (prefsJson.data) {
      session.prefetch.contactPreferences = {
        doNotContact: Boolean(prefsJson.data.doNotContact),
        mailServiceEnrolled: Boolean(prefsJson.data.mailServiceEnrolled),
      };
    }
  }
  if (obj.ok) {
    const objJson = (await obj.json()) as {
      data?: { articleId?: string; body?: string };
    };
    if (objJson.data?.body) {
      session.prefetch.objection = {
        articleId: objJson.data.articleId ?? "DEMO-OBJECTION-RETAIL-v1",
        body: objJson.data.body,
      };
    }
  }
  if (svc.ok) {
    const svcJson = (await svc.json()) as {
      data?: { articleId?: string; displayName?: string; body?: string };
    };
    const d = svcJson.data;
    if (d) {
      session.prefetch.serviceGuide = {
        articleId: d.articleId ?? "DEMO-SERVICE-v1",
        displayName: d.displayName ?? "",
        body: d.body ?? "",
      };
    }
  }
  const rxResp = await fetch(
    `${origin}/api/simulated/pharmacy/prescriptions?memberId=${encodeURIComponent(memberId)}`,
    { cache: "no-store" },
  );
  if (rxResp.ok) {
    const rxJson = (await rxResp.json()) as {
      data?: { prescriptions?: Array<{ drugName?: string }> };
    };
    session.prefetch.prescriptions = (rxJson.data?.prescriptions ?? [])
      .map((p) => ({ drugName: String(p.drugName ?? "") }))
      .filter((p) => p.drugName);
  }
}

export async function applyGovernedUtteranceRules(
  session: SessionState,
  origin: string,
  line: { id?: string; speaker: string; stability: string; text: string },
) {
  const beforeTitle = session.nowCard.title;
  const beforeBody = session.nowCard.body;
  const beforeConsent = session.consent.comparison;
  if (line.speaker === "member" && line.stability === "partial") {
    appendJsonl(session.sessionId, {
      kind: "governed_utterance",
      eventId: line.id,
      speaker: line.speaker,
      stability: line.stability,
      comparison: "wait",
      ninetyDay: false,
      displayChanged: false,
      nowTitle: session.nowCard.title,
    });
    return;
  }
  if (line.stability === "uncertain") return;
  const rules = session.utteranceRules;
  const text = line.text;
  const lastAdv =
    [...session.transcript]
      .reverse()
      .find((t) => t.speaker === "advocate")?.text ?? "";

  if (
    line.speaker === "member" &&
    (line.stability === "final" || line.stability === "corrected") &&
    isNinetyDayQuestion(rules, text)
  ) {
    markServiceDiscussed(session);
    await loadFast90(session, origin);
    recordNeedPath(session, line.id, "service_education", "code_rule");
  }
  if (
    line.speaker === "advocate" &&
    matchesAny(rules?.advocateServiceIntro, text)
  ) {
    markServiceDiscussed(session);
  }

  if (
    line.speaker === "advocate" &&
    matchesAny(rules?.scopedComparisonAsk, text)
  ) {
    markPricingUpcoming(session);
  }

  const comparison = classifyComparisonConsent({
    rules,
    speaker: line.speaker,
    text,
    stability: line.stability,
    optionalWorkSuppressed: session.optionalWorkSuppressed,
    scopedPending:
      Boolean(session.consent.clarification) ||
      matchesAny(rules?.scopedComparisonAsk, lastAdv),
    lastAdvocate: lastAdv,
  });
  if (comparison === "hedge") {
    session.consent.comparison = "hedge";
    showClarifyOnce(session, "Clarify comparison interest", CLARIFY_INTEREST);
  }
  if (comparison === "absolute_yes") {
    await settleComparisonYes(session, origin, line.id, "code_rule");
  }

  if (
    line.speaker === "advocate" &&
    matchesAny(rules?.readyForPickup, text)
  ) {
    upsertNeed(session, "refill_status", {
      status: "resolved",
      flowStep: "explain status → wrap path",
    });
    await maybeCompleteServicing(session);
  }
  if (
    line.speaker === "member" &&
    (line.stability === "final" || line.stability === "corrected") &&
    isDirectNamedQuoteAsk(text, sessionQuoteEntities(session))
  ) {
    session.consent.comparison = "absolute_yes";
    session.consent.comparisonScopeKey = "named_quote";
    session.consent.comparisonUtteranceId = line.id ?? null;
    session.consent.clarification = null;
    session.consent.clarificationShown = false;
    markPricingDueFromConsent(session);
    const ph = pharmacyIdFromUtterance(session, text);
    const drug = namedMedicationsInText(
      text,
      sessionQuoteEntities(session).drugs,
    )[0];
    await requestQuotes(session, origin, ph, drug);
  }
  if (
    line.speaker === "member" &&
    (line.stability === "final" || line.stability === "corrected") &&
    session.quotes.length > 0 &&
    /(?:\bnot\b|\binstead\b|i meant|actually)\b/i.test(text)
  ) {
    const ph = pharmacyIdFromUtterance(session, text);
    if (ph && ph !== session.quoteFocus?.pharmacyId) {
      const drug =
        namedMedicationsInText(text, sessionQuoteEntities(session).drugs)[0] ??
        session.quoteFocus?.drug;
      await requestQuotes(session, origin, ph, drug);
    }
  }

  if (
    line.speaker === "member" &&
    (line.stability === "final" || line.stability === "corrected") &&
    matchesAll(rules?.splitElection, text)
  ) {
    const deliveryMatch = text.match(
      /delivery for (?:the )?([^.]+?)(?:\.|$)/i,
    );
    const fromClause = namedMedicationsInText(
      deliveryMatch?.[1] ?? "",
      sessionQuoteEntities(session).drugs,
    );
    if (fromClause.length) {
      setEnrollmentMedications(session, fromClause);
      upsertNeed(session, "service_election", {
        status: "active",
        guidance: "ready",
        flowStep: "enroll/decline — scoped election",
      });
      showNow(session, {
        title: "Enrollment draft — scoped",
        body: session.enrollment.readback,
        sourceLabel: "Governed guidance · scripting · simulated",
      });
    }
  }
  if (
    line.speaker === "member" &&
    session.enrollment.medications.length > 0 &&
    !session.enrollment.withdrawn &&
    !session.enrollment.resultId &&
    lastAdvocateIsCurrentReadback(session)
  ) {
    const decision = classifyEnrollmentConsent({
      rules,
      speaker: line.speaker,
      text,
      stability: line.stability,
      draftMedications: session.enrollment.medications,
      readback: session.enrollment.readback,
      readbackPending: readbackPending(session),
    });
    if (decision === "absolute_yes") {
      session.consent.enrollment = "absolute_yes";
      session.consent.enrollmentScopeKey = normalizeScopeKey(
        session.enrollment.medications,
      );
      session.consent.enrollmentUtteranceId = line.id ?? null;
      session.consent.clarification = null;
      session.consent.clarificationShown = false;
    } else if (decision === "hedge" || decision === "clarify") {
      session.consent.enrollment = "hedge";
      showClarifyOnce(
        session,
        "Clarify enrollment",
        "To confirm: do you want to submit the enrollment we just read back?",
      );
    }
  }
  if (line.speaker === "member" && matchesAny(rules?.withdraw, text)) {
    applyHumanWithdrawEnrollment(session);
  }
  if (line.speaker === "member" && matchesAny(rules?.firmRefusal, text)) {
    session.optionalWorkSuppressed = true;
    session.recommendation = null;
    session.consent.comparison = "none";
    session.consent.enrollment = "none";
  }
  appendJsonl(session.sessionId, {
    kind: "governed_utterance",
    eventId: line.id,
    speaker: line.speaker,
    stability: line.stability,
    comparison,
    ninetyDay: isNinetyDayQuestion(rules, text),
    displayChanged:
      session.nowCard.title !== beforeTitle ||
      session.nowCard.body !== beforeBody ||
      session.consent.comparison !== beforeConsent,
    nowTitle: session.nowCard.title,
  });
}

export async function processTranscriptEvent(
  session: SessionState,
  origin: string,
  line: {
    id: string;
    speaker: string;
    stability: string;
    text: string;
    offsetMs?: number;
  },
) {
  const jobKey = `${session.sessionId}:${line.speaker}`;
  let interpP: Promise<Interpretation> | null = null;
  let applyMode: "none" | "applied_partial" | "rerun" = "none";
  let seq = session.lunaSeq;
  if (line.stability === "final" || line.stability === "corrected") {
    session.lunaSeq += 1;
    seq = session.lunaSeq;
  }
  const consentAnchor = consentAnchorOf(session);
  const pending = partialJobs.get(jobKey);
  const runInterpret = () =>
    testInterpretFactory
      ? testInterpretFactory(session, line)
      : interpretUtterance(session, line);
  if (
    line.stability !== "uncertain" &&
    session.identityStatus === "VALID"
  ) {
    if (line.stability === "partial") {
      interpP = runInterpret();
      partialJobs.set(jobKey, { text: line.text, promise: interpP });
    } else if (
      pending &&
      finalCompatibleWithPartial(pending.text, line.text)
    ) {
      interpP = pending.promise;
      applyMode = "applied_partial";
      partialJobs.delete(jobKey);
    } else {
      interpP = runInterpret();
      applyMode = "rerun";
      partialJobs.delete(jobKey);
    }
  }
  await applyAdvocateObligations(session, line);
  const markApplied = () => {
    if (line.stability === "partial") return;
    session.lastAppliedEventId = line.id;
    publishSession(session);
  };
  if (line.stability === "uncertain") {
    markApplied();
    return;
  }
  if (session.identityStatus !== "VALID") {
    markApplied();
    return;
  }
  await applyGovernedUtteranceRules(session, origin, line);
  if (!interpP) {
    markApplied();
    return;
  }
  if (line.speaker === "advocate") markApplied();
  void (async () => {
    try {
      if (!interpP) return;
      const interp = await interpP;
      if (
        testDelayApply &&
        testDelayApply.eventId === line.id &&
        testDelayApply.ms > 0
      ) {
        await new Promise((r) => setTimeout(r, testDelayApply!.ms));
      }
      appendJsonl(session.sessionId, {
        kind: "luna_interpret",
        eventId: line.id,
        ms: interp.ms,
        ok: interp.ok,
        httpStatus: interp.httpStatus,
        error: interp.error,
        n90: interp.ninetyDayAsked,
        cc: interp.comparisonConsent,
        ha: interp.historicalAsked,
        qp: interp.quotePharmacy,
        usage: interp.usage,
        applyMode,
        seq,
        raw: interp.raw.slice(0, 180),
      });
      session.lastInterpretation = {
        eventId: line.id,
        ...interp,
        raw: interp.raw.slice(0, 500),
      };
      session.modelHealth = {
        ...session.modelHealth,
        luna: {
          ok: interp.ok,
          status: interp.httpStatus ?? 0,
          error: interp.error,
          ms: interp.ms,
          at: new Date().toISOString(),
        },
      };
      if (line.stability === "partial") return;
      await applyInterpretation(
        session,
        origin,
        line,
        interp,
        line.stability === "final" || line.stability === "corrected",
        { seq, consentAnchor },
      );
      if (
        line.speaker === "member" &&
        (line.stability === "final" || line.stability === "corrected")
      ) {
        const owned = session.needs.find((n) => n.sourceUtteranceId === line.id);
        if (interp.returnToHistorical) {
          // resumeParkedNeed already ran from interpretation
        } else {
          const waiting = waitingNeedMatchingUtterance(session, line.text);
          if (waiting) {
            await resumeParkedNeed(session, origin, waiting);
          } else {
            await runMemberQuestionLoop(
              session,
              origin,
              line.text,
              owned?.kind,
              line.id,
            );
          }
        }
      }
      publishSession(session);
    } finally {
      if (line.speaker !== "advocate") markApplied();
    }
  })();
}
