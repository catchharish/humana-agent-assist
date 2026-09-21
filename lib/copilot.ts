import { invalidateSessionTokens, normalizeScopeKey } from "@/lib/enrollmentToken";
import { interpretUtterance, finalCompatibleWithPartial, type Interpretation } from "@/lib/interpret";
import { terraComplete, parseJsonObject } from "@/lib/openai";
import { questionCouldChange, runAnswerLoop, retrievedFingerprint } from "@/lib/answerLoop";
import {
  closeLookupWithoutAnswer,
  holdPhraseFor,
  isInjectedHoldId,
  lastUnansweredMemberQuestion,
  lookupHasAnswer,
  markLookupAnswered,
  memberOnHold,
  openLookup,
  startLookupProgress,
} from "@/lib/lookupProgress";
import { supportCheck } from "@/lib/supportCheck";
import {
  proposeNba,
  logNbaAdvocate,
  logNbaAttempt,
  promoteNextRecommendation,
  seatRecommendation,
} from "@/lib/nba";
import { fetchMemberQuotes } from "@/lib/quotesFetch";
import { publishSession } from "@/lib/sse";
import { appendJsonl } from "@/lib/log";
import {
  logObligationTransitions,
  noteCheckSource,
} from "@/lib/obligationLog";
import {
  CLARIFY_INTEREST,
  NUDGE_CLOSING,
  NUDGE_PARAPHRASE,
  NUDGE_PRICING,
  clarifyInterest,
  enrollmentReadback,
} from "@/lib/copy";
import { isExactReading, isWordingAttempt, stitchedReading, wordDiff, contentWords } from "@/lib/exactness";
import {
  beginAnswerLoop,
  getNeed,
  getSession,
  ingestTranscript,
  markEventApplied,
  recordActionResult,
  recordNeedAnswer,
  pushRouterTrace,
  pushTriggerTrace,
  requiredPricingOnNow,
  requiredWordingOnNow,
  setFocus,
  shouldApplyAnswerLoop,
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
  resolveQuotePharmacyId,
  type NamedPharmacy,
} from "@/lib/utteranceRules";
import type { NeedKind, SessionState } from "@/lib/types";
import { needHasRealAnswer, parkedNeedKindForUtterance, preferNeedQueryText } from "@/lib/parkedNeed";
import { classifyLunaTrigger, classifyPricingTrigger, closingAttemptCues } from "@/lib/triggers";

const historicalJobs = new Map<string, string>();

function sameQuestionOnHold(
  session: SessionState,
  question: string,
  sourceUtteranceId?: string,
) {
  const open = openLookup(session);
  if (sourceUtteranceId && open?.sourceUtteranceId === sourceUtteranceId) {
    return true;
  }
  if (open?.question && !questionCouldChange(open.question, question)) {
    return true;
  }
  if (
    session.rightNowLine &&
    !questionCouldChange(session.rightNowLine, question)
  ) {
    return true;
  }
  return compatibleLoopRunning(session, question);
}

function injectAdvocateHold(session: SessionState, sourceUtteranceId?: string) {
  if (requiredWordingOnNow(session)) return;
  const id = `hold-${sourceUtteranceId || session.answerLoopGeneration}`;
  if (session.transcript.some((t) => t.id === id)) return;
  const text = holdPhraseFor(id);
  ingestTranscript(session, {
    id,
    speaker: "advocate",
    stability: "final",
    text,
    inputSource: "stream",
  });
  appendJsonl(session.sessionId, {
    kind: "advocate_hold_injected",
    sourceUtteranceId: sourceUtteranceId ?? null,
    text,
  });
}

function needKindFromInterp(interp: Interpretation): NeedKind | undefined {
  if (interp.refillCheck !== "none") return "refill_status";
  if (interp.historicalAsked || interp.returnToHistorical) {
    return "historical_price";
  }
  if (interp.coverageAsked) return "coverage_status";
  if (interp.ninetyDayAsked) return "service_education";
  if (interp.focusKind) return interp.focusKind;
  return undefined;
}

function compatibleLoopRunning(session: SessionState, text: string) {
  const a = session.answerLoopAnchor;
  if (!a) return false;
  if (!shouldApplyAnswerLoop(session, a.generation)) return false;
  return !questionCouldChange(a.question, text);
}

function looksLikeMemberQuestionOrRequest(text: string) {
  return (
    /\?/.test(text) ||
    /^(?:what|why|how|when|where|which|who|can|could|would|will|is|are|do|does|did|tell|check|explain|please|i (?:want|need|would like)|just)\b/i.test(
      text.trim(),
    ) ||
    /\b(?:i (?:want|need|would like)|(?:can|could|would|will) you|please|help me|for me|me now)\b/i.test(
      text,
    )
  );
}

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
    dueNow: requiredWordingOnNow(session),
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
  opts?: { paint?: boolean },
) {
  if (!question.trim()) return;
  const paint = opts?.paint !== false;
  const owned = sourceUtteranceId
    ? session.needs.find((n) => n.sourceUtteranceId === sourceUtteranceId)
    : undefined;
  const kind = owned?.kind ?? needKind;
  const provisional = !kind;
  try {
    const holding =
      memberOnHold(session) &&
      !sameQuestionOnHold(session, question, sourceUtteranceId);
    if (kind && !holding) {
      const bound = getNeed(session, kind, sourceUtteranceId);
      if (!bound?.queryText) {
        upsertNeed(session, kind, {
          queryText: question,
          sourceUtteranceId:
            sourceUtteranceId ?? getNeed(session, kind)?.sourceUtteranceId,
        });
      }
      setFocus(
        session,
        kind,
        getNeed(session, kind, sourceUtteranceId)?.flowStep ||
          "interpret request → answer, withhold, or preserve limitation",
      );
    }
    if (holding) {
      if (kind) {
        upsertNeed(session, kind, {
          queryText: question,
          sourceUtteranceId:
            sourceUtteranceId ?? getNeed(session, kind)?.sourceUtteranceId,
          status: "deferred",
          guidance: "preparing",
          flowStep: "waiting while another question is on hold",
        });
      }
      startLookupProgress(session, question, sourceUtteranceId);
      publishSession(session);
      await runAnswerLoop({
        ...answerLoopBase(session, origin, question),
        generation: session.answerLoopGeneration + 10_000,
        paintNow: false,
        needKind: kind,
        sourceUtteranceId,
        provisionalNeed: provisional,
      });
      return;
    }
    const generation = paint
      ? beginAnswerLoop(session, question, kind, sourceUtteranceId)
      : session.answerLoopGeneration + 1;
    // Start lookup + hold immediately so playback waits for the say (and ~3.5s
    // dwell) before the next member line. Luna kind is optional — Terra may still
    // answer when Luna returns none.
    if (paint && !lookupHasAnswer(session) && !requiredWordingOnNow(session)) {
      startLookupProgress(session, question, sourceUtteranceId);
      injectAdvocateHold(session, sourceUtteranceId);
    }
    publishSession(session);
    const result = await runAnswerLoop({
      ...answerLoopBase(session, origin, question),
      generation,
      paintNow: paint,
      needKind: kind,
      sourceUtteranceId,
      provisionalNeed: provisional,
    });
    if (/^\s*no new answer\s*$/i.test(result.answer ?? "")) {
      closeLookupWithoutAnswer(session, "nothing_needed", sourceUtteranceId);
      if (sourceUtteranceId) {
        session.needs = session.needs.filter(
          (need) =>
            need.sourceUtteranceId !== sourceUtteranceId ||
            Boolean(need.answer?.body),
        );
      }
      appendJsonl(session.sessionId, {
        kind: "line_need_withdrawn",
        needKind: kind ?? null,
        sourceUtteranceId: sourceUtteranceId ?? null,
        queryText: question,
      });
    }
  } catch (err) {
    appendJsonl(session.sessionId, {
      kind: "answer_loop_error",
      need: kind ?? "member_question",
      error: String(err),
    });
    const logged = session.diagnostics.nba.some((r) =>
      ["proposal", "hard_stop", "cap_drop", "failed"].includes(String(r.event)),
    );
    if (!logged) {
      logNbaAttempt(session, {
        at: new Date().toISOString(),
        event: "failed",
        status: "answer_loop_error",
        detail: String(err),
        question,
      });
    }
  }
}

export async function resumeParkedNeed(
  session: SessionState,
  origin: string,
  kind: NeedKind,
) {
  const need = getNeed(session, kind);
  const queryText = need?.queryText;
  const loopRunningForThis =
    Boolean(session.answerLoopAnchor) &&
    shouldApplyAnswerLoop(session, session.answerLoopGeneration) &&
    (session.answerLoopAnchor?.needKind === kind ||
      session.answerLoopAnchor?.sourceUtteranceId === need?.sourceUtteranceId ||
      Boolean(
        queryText &&
          session.answerLoopAnchor?.question &&
          !questionCouldChange(session.answerLoopAnchor.question, queryText),
      ));
  if (loopRunningForThis && !need?.answer?.body) {
    appendJsonl(session.sessionId, {
      kind: "lookup_resume_skipped",
      needKind: kind,
      reason: "answer_loop_running",
    });
    return;
  }
  setFocus(session, kind, need?.flowStep ?? "advocate-selected focus");
  beginAnswerLoop(
    session,
    queryText || need?.answer?.title || "",
    kind,
    need?.sourceUtteranceId,
  );
  if (need?.answer?.body) {
    showNow(
      session,
      {
        title: need.answer.title,
        body: need.answer.body,
        sourceLabel: need.answer.sourceLabel,
        statements: need.answer.statements,
        usedSources: need.answer.usedSources,
        headline: need.answer.title,
      },
      { priority: "answer", needKind: kind },
    );
    upsertNeed(session, kind, {
      status: "resolved",
      guidance: "deferred_valid",
      flowStep: need.flowStep ?? "explain parked answer",
    });
    session.rightNowLine = queryText || need.answer.title || session.rightNowLine;
    // Fresh dwell clock so playback waits on the restored say (e.g. return to metformin).
    startLookupProgress(session, queryText || need.answer.title, need.sourceUtteranceId);
    markLookupAnswered(session, need.sourceUtteranceId);
    publishSession(session);
    return;
  }
  if (!queryText) return;
  startLookupProgress(session, queryText, need?.sourceUtteranceId);
  injectAdvocateHold(session, need?.sourceUtteranceId);
  publishSession(session);
  const prevFp = need?.fingerprint ?? "";
  const generation = session.answerLoopGeneration;
  upsertNeed(session, kind, {
    status: "active",
    guidance: "preparing",
    flowStep: "recheck dependencies → explain or preserve gap",
  });
  setFocus(session, kind, "recheck dependencies → explain or preserve gap");
  try {
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
  return lastAdv;
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
  const q = session.quotes.find((x) =>
    /mail|delivery/i.test(x.pharmacyName),
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
  return parkedNeedKindForUtterance(session.needs, text, sessionQuoteEntities(session).drugs);
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

function sessionPharmacies(session: SessionState): NamedPharmacy[] {
  const refill = session.prefetch?.refill as
    | {
        pharmacyId?: string;
        pharmacyName?: string;
        provider?: { organizationName?: string };
      }
    | null
    | undefined;
  const extraName =
    refill?.pharmacyName || refill?.provider?.organizationName || "";
  const extraId = refill?.pharmacyId || "";
  const rows: NamedPharmacy[] = [
    ...session.quotes.map((q) => ({
      id: q.pharmacyId || q.pharmacyName,
      name: q.pharmacyName,
    })),
    ...(extraName || extraId
      ? [{ id: extraId || extraName, name: extraName || extraId }]
      : []),
  ].filter((p) => p.id || p.name);
  const seen = new Set<string>();
  const out: NamedPharmacy[] = [];
  for (const p of rows) {
    const key = (p.id || p.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: p.id || p.name, name: p.name || p.id });
  }
  return out;
}

function pharmacyIdFromUtterance(session: SessionState, text: string) {
  return resolveQuotePharmacyId(text, null, sessionPharmacies(session));
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
      usedSources: [],
      statements: undefined,
      earlyFacts: [],
      liveSteps: [],
    },
    { priority: "nudge" },
  );
  // Clarify is not a need answer — drop the prior need binding so tips cannot
  // treat the hedge line as "caller moved on" from an old say.
  session.nowCardNeedKind = null;
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
    // After the deadline nudge, only short recovery attempts (e.g. "These prices
    // might change") rebuild the paraphrase card — not the estimate line that
    // caused the miss (it also matches price|estimate|change).
    const cueAttempt =
      Boolean(session.nudge) &&
      /\b(prices?|change)\b/i.test(heard) &&
      !/\b\d|dollar/i.test(heard) &&
      contentWords(heard).length <= 10;
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

function paintClosingNow(session: SessionState) {
  const req = closingRequirement(session);
  const unverified = session.closing === "unable_to_verify";
  showNow(
    session,
    {
      title: unverified
        ? "Closing could not be verified"
        : "Closing statement due now",
      body: req?.verbatimText ?? "",
      sourceLabel: "Governed guidance · scripting · simulated",
    },
    { priority: unverified ? "nudge" : "due_now" },
  );
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
  if (lineId) session.consent.comparisonUtteranceId = lineId;
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
  const usedSources = art
    ? [
        {
          id: art.articleId,
          tag: "Plan rules",
          text:
            art.body.replace(/\s+/g, " ").trim().slice(0, 89) +
            (art.body.replace(/\s+/g, " ").trim().length > 90 ? "…" : ""),
        },
        ...(art.lineageSourceId && art.lineageSourceId !== art.articleId
          ? [
              {
                id: art.lineageSourceId,
                tag: "Plan rules",
                text: `Derived from ${art.lineageSourceId}`,
              },
            ]
          : []),
      ]
    : [];
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
  const sourceLabel = `Derived from source/version · scripting · simulated (${art?.articleId} ← ${art?.lineageSourceId})`;
  upsertNeed(session, "service_education", {
    status: "active",
    guidance: "ready",
    flowStep: "educate (derived DEMO-FAST90-v1)",
    answer: {
      title: "90-day option",
      body: art?.body || "Derived 90-day guidance unavailable.",
      sourceLabel,
      usedSources,
    },
  });
  if (updateFocus) {
    setFocus(session, "service_education", "educate → confirm interest");
  }
  showNow(
    session,
    {
      title: "90-day option",
      body: art?.body || "Derived 90-day guidance unavailable.",
      sourceLabel,
      usedSources,
    },
    { priority: "answer", needKind: "service_education" },
  );
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
  promoteNextRecommendation(session);
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

async function maybeCompleteServicing(session: SessionState, origin: string) {
  const decline = (reason: string) => {
    appendJsonl(session.sessionId, {
      kind: "servicing_completion_declined",
      reason,
      needs: session.needs.map((n) => ({
        kind: n.kind,
        status: n.status,
        guidance: n.guidance,
      })),
    });
  };
  if (session.coverage) return decline("coverage_case_open");
  if (session.enrollment.submitted) return decline("enrollment_submitted");
  if (getNeed(session, "historical_price")) return decline("historical_price_need");
  if (getNeed(session, "coverage_status")) return decline("coverage_status_need");
  const lastQ = lastUnansweredMemberQuestion(session);
  if (
    lastQ &&
    !session.needs.some(
      (n) =>
        Boolean(n.answer?.body) &&
        (n.sourceUtteranceId === lastQ.id ||
          n.queryText === lastQ.text ||
          parkedNeedKindForUtterance([n], lastQ.text) === n.kind),
    )
  ) {
    return decline("unanswered_member_question");
  }
  if (session.needs.some((n) => n.guidance === "preparing" && !n.answer?.body)) {
    return decline("need_preparing");
  }
  if (getNeed(session, "prospective_comparison")) {
    return decline("prospective_comparison_need");
  }
  const election = getNeed(session, "service_election");
  if (election && !session.enrollment.withdrawn) {
    return decline("open_service_election");
  }
  const unanswered = session.needs.some(
    (n) =>
      (n.kind === "unrecognized_request" || n.kind === "unsupported_work") &&
      n.status !== "resolved",
  );
  if (unanswered) return decline("unanswered_request_need");
  const refillDone = getNeed(session, "refill_status")?.status === "resolved";
  const educationClosed =
    session.serviceDiscussed && session.closing === "exact_timely";
  if (!refillDone && !educationClosed) return decline("no_completed_servicing");
  await finalizeCall(session, origin, {
    trigger: "simple_servicing_completed",
    terminal: true,
    ignoreActiveInterpretations: 1,
  });
}

function documentationSources(session: SessionState) {
  const needs = session.needs.map((need, index) => ({
    id: `need:${need.sourceUtteranceId ?? `${need.kind}:${index}`}`,
    kind: "record" as const,
    sourceTag: need.answer?.sourceLabel ?? "Call need",
    text: need.answer?.body
      ? need.answer.body
      : JSON.stringify({
          question: need.queryText ?? need.kind,
          status:
            need.answer?.body && need.status === "deferred"
              ? "resolved"
              : need.status,
          guidance: need.guidance,
          resolved:
            Boolean(need.answer?.body) || need.status === "resolved",
          unresolved:
            need.status === "unresolved_gap" ||
            need.guidance === "invalidated",
        }),
  }));
  const actions = session.actionResults.map((action, index) => ({
    id: `action:${action.kind}:${index}`,
    kind: "record" as const,
    sourceTag: action.sourceLabel,
    text: action.body,
  }));
  const transcript = session.transcript
    .filter((line) => line.stability !== "partial")
    .map((line) => ({
      id: `transcript:${line.id}`,
      kind: "transcript" as const,
      sourceTag: `Transcript · ${line.speaker}`,
      text: line.text,
    }));
  return [...needs, ...actions, ...transcript];
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
  const documentation = documentationSources(session);
  const terra = await terraComplete(
    `Write a concise wrap note of completed servicing so far. JSON only:
{"statements":[{"text":"one sentence","sourceId":"one Evidence source id"}]}
Rules: use only Evidence. State what was resolved, what remains unresolved, what the member declined, and what the advocate still has to do when Evidence supports each item. Do not state a transfer connection, specialist connected, enrollment, approval, pickup, or coverage determination unless its completed action-result source is in Evidence.
Every sentence must cite exactly one sourceId from Evidence. Evidence contains each need's current answer or unresolved state, each completed human action result, and attributable transcript lines:
${JSON.stringify(documentation)}`,
    500,
  );
  const parsed = parseJsonObject<{
    statements?: Array<{ text?: string; sourceId?: string }>;
  }>(terra.text);
  const generatedStatements = (parsed?.statements ?? [])
    .map((statement) => ({
      text: String(statement.text ?? "").trim(),
      sourceId: String(statement.sourceId ?? "").trim(),
    }))
    .filter((statement) => statement.text && statement.sourceId);
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
    generatedStatements.map((statement) => statement.text).join(" ") ||
    (terra.ok ? terra.text : "Wrap draft unavailable. Use a labeled manual template.");
  if (!session.transfer.connectionStatus) {
    session.wrapDraft = session.wrapStable;
  }
  const wrapRetrieved = [
    ...session.retrievedSources,
    ...documentation,
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
    statements: generatedStatements.length ? generatedStatements : undefined,
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
    : session.transfer.destinationConfirmed || session.transfer.transferId
      ? "No confirmed connection result exists; do not state a transferred outcome."
      : "";
  session.wrapDraft = [session.wrapStable, outcome, wrapEvidenceLine(session)]
    .filter(Boolean)
    .join("\n\n");
  session.outcomeReady = true;
}

type DispositionOption = {
  code: string;
  meaning: string;
  safetyRequirement: string;
};

function parseDispositionOptions(text: string): DispositionOption[] {
  return text
    .split(/\n\s*\n(?=Code:)/)
    .map((block) => {
      const code = /Code:\s*([A-Z0-9_]+)/.exec(block)?.[1] ?? "";
      const meaning = /Meaning:\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
      const safetyRequirement =
        /Safety requirement:\s*([a-z_]+)/i.exec(block)?.[1]?.toLowerCase() ??
        "none";
      return { code, meaning, safetyRequirement };
    })
    .filter((option) => option.code && option.meaning);
}

function confirmedConnection(session: SessionState) {
  return (
    session.transfer.connectionStatus?.toLowerCase() ===
    "receiving_specialist_connected"
  );
}

function confirmedEnrollment(session: SessionState) {
  return Boolean(
    session.enrollment.submitted &&
      session.enrollment.scopeOk &&
      session.enrollment.resultId &&
      session.actionResults.some((action) => action.kind === "enrollment_submit"),
  );
}

function dispositionSafety(
  session: SessionState,
  option: DispositionOption,
): { ok: boolean; reason?: string } {
  if (!session.callEnd.triggered) {
    return { ok: false, reason: "end_of_call_not_triggered" };
  }
  if (
    option.safetyRequirement === "confirmed_connection" &&
    !confirmedConnection(session)
  ) {
    return { ok: false, reason: "confirmed_connection_required" };
  }
  if (
    option.safetyRequirement === "confirmed_enrollment" &&
    !confirmedEnrollment(session)
  ) {
    return { ok: false, reason: "confirmed_enrollment_required" };
  }
  return { ok: true };
}

async function loadDispositionDocument(session: SessionState, origin: string) {
  const response = await fetch(
    `${origin}/api/simulated/scripting/knowledge/search`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-authorization-id": session.auth?.authorizationId ?? "",
      },
      body: "{}",
    },
  );
  const json = (await response.json()) as {
    data?: {
      candidates?: Array<{
        id: string;
        kind: string;
        text: string;
      }>;
    };
  };
  const document = (json.data?.candidates ?? []).find(
    (candidate) => candidate.kind === "disposition",
  );
  return { response, document };
}

async function recommendDisposition(session: SessionState, origin: string) {
  if (!session.callEnd.triggered) return;
  const { response, document } = await loadDispositionDocument(session, origin);
  if (!response.ok || !document) {
    session.disposition.recommended = null;
    appendJsonl(session.sessionId, {
      kind: "disposition_recommendation_failed",
      reason: "governed_document_unavailable",
      httpStatus: response.status,
    });
    return;
  }
  const options = parseDispositionOptions(document.text);
  session.disposition.documentId = document.id;
  session.disposition.options = options;
  const evidence = documentationSources(session);
  // A rejected attempt is told why, so the next attempt can repair the same
  // recommendation instead of guessing again. The gates themselves never relax.
  let repairNote = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const terra = await terraComplete(
      `Recommend exactly one end-of-call disposition from the governed document. This is a recommendation for advocate confirmation, not an automatic filing.
Return JSON only:
{"code":"one document code","reasons":[{"text":"one concise factual reason","sourceId":"one Evidence source id"}]}
Use only codes and applicability meanings from Governed disposition document. Use only Evidence for what happened. Every reason must cite exactly one Evidence sourceId and should quote or minimally compress the supporting source so its material values remain unchanged. A handoff draft, transfer offer, destination confirmation, pending transfer, or failed transfer is not a connected transfer. A discussion, comparison consent, draft, or readback is not a completed enrollment.
${repairNote}
Governed disposition document (${document.id}):
${document.text}

Evidence:
${JSON.stringify(evidence)}`,
      420,
    );
    appendJsonl(session.sessionId, {
      kind: "terra_complete",
      task: "disposition",
      attempt,
      ok: terra.ok,
      ms: terra.ms,
      usage: terra.usage ?? null,
      httpStatus: terra.httpStatus,
      error: terra.error,
    });
    const parsed = parseJsonObject<{
      code?: string;
      reasons?: Array<{ text?: string; sourceId?: string }>;
    }>(terra.text);
    const proposedCode = String(parsed?.code ?? "");
    const option = options.find((candidate) => candidate.code === proposedCode);
    if (!option) {
      appendJsonl(session.sessionId, {
        kind: "disposition_recommendation_rejected",
        code: proposedCode || null,
        reason: parsed ? "code_not_in_document" : "unparsable_model_output",
        attempt,
      });
      repairNote = `Your previous answer was rejected: ${
        parsed ? `"${proposedCode}" is not a code in the document` : "the output was not the required JSON object"
      }. Return one code exactly as written in the document.\n`;
      continue;
    }
    const safety = dispositionSafety(session, option);
    if (!safety.ok) {
      appendJsonl(session.sessionId, {
        kind: "disposition_recommendation_rejected",
        code: option.code,
        reason: safety.reason,
        attempt,
      });
      repairNote = `Your previous answer was rejected: ${option.code} needs ${option.safetyRequirement}, which this call's Evidence does not show. Pick the code that matches what Evidence actually shows.\n`;
      continue;
    }
    const statements = (parsed?.reasons ?? [])
      .map((reason) => ({
        text: String(reason.text ?? "").trim(),
        sourceId: String(reason.sourceId ?? "").trim(),
      }))
      .filter(
        (reason) =>
          reason.text &&
          evidence.some((source) => source.id === reason.sourceId),
      );
    const checked = supportCheck({
      question: "disposition reasons",
      answer: statements.map((statement) => statement.text).join(" "),
      statements,
      retrieved: evidence,
      toolsUsed: [],
      snapshotHasPlanRule: false,
      sources: evidence.map((source) => source.id),
    });
    const confirmedReasons = checked.statements.filter(
      (statement) => statement.confirmed,
    );
    if (!confirmedReasons.length) {
      appendJsonl(session.sessionId, {
        kind: "disposition_recommendation_rejected",
        code: option.code,
        reason: "no_reason_survived_support_check",
        attempt,
        proposedReasons: (parsed?.reasons ?? []).map((reason) => ({
          text: String(reason.text ?? ""),
          sourceId: String(reason.sourceId ?? ""),
          citedIdInEvidence: evidence.some(
            (source) => source.id === String(reason.sourceId ?? "").trim(),
          ),
        })),
        checkNotes: checked.statements.map((statement) => statement.note),
      });
      repairNote = `Your previous answer (${option.code}) was rejected: no reason passed the support check${
        checked.statements.length
          ? ` (${checked.statements.map((s) => s.note ?? "unconfirmed").join(", ")})`
          : " (no reason cited an Evidence id)"
      }. Keep the code if Evidence supports it, but quote the supporting Evidence text verbatim, and cite that record's exact id.\n`;
      continue;
    }
    session.disposition.recommended = option.code;
    session.disposition.confirmed = null;
    session.disposition.reasons = confirmedReasons;
    appendJsonl(session.sessionId, {
      kind: "disposition_recommended",
      code: option.code,
      documentId: document.id,
      reasons: confirmedReasons,
    });
    return;
  }
  session.disposition.recommended = null;
  session.disposition.reasons = [];
  appendJsonl(session.sessionId, {
    kind: "disposition_recommendation_failed",
    reason: "no_safe_supported_model_recommendation",
    documentId: document.id,
  });
}

function settleRequirementsAtCallEnd(session: SessionState) {
  if (
    session.greeting !== "exact_timely" &&
    session.greeting !== "late_finding"
  ) {
    session.greeting = "missed_not_recoverable";
  }
  if (
    session.pricing !== "not_applicable" &&
    !session.pricingExactDelivered &&
    session.pricing !== "exact_timely"
  ) {
    session.pricing = "missed_not_recoverable";
    session.pricingNote =
      "Call ended before the required exact pricing statement was delivered.";
  }
  if (session.serviceDiscussed) {
    if (session.closing !== "exact_timely") {
      session.closing = "missed_not_recoverable";
      session.closingLocked = true;
      session.closingNote =
        "Call ended before the required exact closing statement was delivered; it is not recoverable.";
    }
  } else {
    session.closing = "not_applicable";
    session.closingNote = null;
  }
}

async function waitForPendingAnswers(
  session: SessionState,
  ignoreActiveInterpretations = 0,
) {
  const started = Date.now();
  const pending = () =>
    session.activeInterpretations > ignoreActiveInterpretations ||
    session.needs.some(
      (need) => need.guidance === "preparing" && !need.answer,
    );
  while (pending() && Date.now() - started < 8000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const line of session.transcript) {
    if (
      line.speaker !== "member" ||
      line.stability === "partial" ||
      !looksLikeMemberQuestionOrRequest(line.text) ||
      session.needs.some((need) => need.sourceUtteranceId === line.id)
    ) {
      continue;
    }
    upsertNeed(session, "unrecognized_request", {
      status: "unresolved_gap",
      guidance: "invalidated",
      flowStep: "request unresolved at call end",
      queryText: line.text,
      sourceUtteranceId: line.id,
    });
  }
  for (const need of session.needs) {
    if (need.guidance === "preparing" && !need.answer) {
      need.status = "unresolved_gap";
      need.guidance = "invalidated";
      need.flowStep = `${need.flowStep} — unresolved at call end`;
      appendJsonl(session.sessionId, {
        kind: "answer_unresolved_at_call_end",
        needKind: need.kind,
        sourceUtteranceId: need.sourceUtteranceId ?? null,
        waitedMs: Date.now() - started,
      });
    }
  }
}

export async function finalizeCall(
  session: SessionState,
  origin: string,
  opts: {
    trigger: "exact_closing" | "simple_servicing_completed" | "transfer_executed" | "telephony_hangup";
    terminal: boolean;
    hangupId?: string | null;
    ignoreActiveInterpretations?: number;
  },
) {
  if (session.callEnd.finalizing) {
    while (session.callEnd.finalizing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      session.callEnd.trigger !== opts.trigger ||
      (opts.terminal && !session.callEnd.ended)
    ) {
      return finalizeCall(session, origin, opts);
    }
    return;
  }
  session.callEnd.triggered = true;
  session.callEnd.finalizing = true;
  session.callEnd.trigger = opts.trigger;
  if (opts.hangupId) session.callEnd.hangupId = opts.hangupId;
  appendJsonl(session.sessionId, {
    kind: "end_of_call_started",
    trigger: opts.trigger,
    terminal: opts.terminal,
  });
  try {
    if (opts.terminal) {
      settleRequirementsAtCallEnd(session);
      logObligationTransitions(session);
      await waitForPendingAnswers(
        session,
        opts.ignoreActiveInterpretations ?? 0,
      );
      session.callEnd.ended = true;
      session.callEnd.endedAt = new Date().toISOString();
      session.reviewStep = 1;
      session.rightNowLine = "The call has ended — review and confirm";
    }
    const wrapStarted = performance.now();
    await draftWrapStable(session);
    fillWrapOutcome(session);
    session.callEnd.wrapMs = performance.now() - wrapStarted;
    await recommendDisposition(session, origin);
    appendJsonl(session.sessionId, {
      kind: "end_of_call_completed",
      trigger: opts.trigger,
      terminal: opts.terminal,
      wrapMs: session.callEnd.wrapMs,
      disposition: session.disposition.recommended,
    });
  } finally {
    session.callEnd.finalizing = false;
    publishSession(session);
  }
}

function assessClosing(
  session: SessionState,
  line: { id?: string; text: string; stability: string },
  origin?: string,
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
    paintClosingNow(session);
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
    if (origin) {
      void finalizeCall(session, origin, {
        trigger: "exact_closing",
        terminal: false,
      });
    } else {
      void draftWrapStable(session);
    }
    return;
  }
  if (
    (line.stability === "final" || line.stability === "corrected") &&
    looksLikeClosing(session, heard) &&
    isWordingAttempt(heard, req.verbatimText)
  ) {
    session.closing = "paraphrased";
    const diff = wordDiff(heard, req.verbatimText);
    session.nudge = {
      template: NUDGE_CLOSING,
      heard,
      requiredText: req.verbatimText,
      missingFromHeard: diff.missingFromHeard,
      extraInHeard: diff.extraInHeard,
    };
    paintClosingNow(session);
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
  const documentation = documentationSources(session);
  const terra = await terraComplete(
    `Draft a short advocate-to-Coverage-Review handoff. JSON only:
{"statements":[{"text":"one sentence","sourceId":"one Evidence source id"}]}
Rules: use only relevant Evidence. Include the requested medication and status, what the member asked, what was checked, enrollment result if present, and today's pickup restriction if supported. No approval, promised service time, full transcript, or connection claim. Every sentence must cite exactly one sourceId from Evidence.
Evidence contains each need's current answer and each completed human action result:
${JSON.stringify(documentation)}`,
    500,
  );
  const parsed = parseJsonObject<{
    statements?: Array<{ text?: string; sourceId?: string }>;
  }>(terra.text);
  const generatedStatements = (parsed?.statements ?? [])
    .map((statement) => ({
      text: String(statement.text ?? "").trim(),
      sourceId: String(statement.sourceId ?? "").trim(),
    }))
    .filter((statement) => statement.text && statement.sourceId);
  session.handoffDraft =
    generatedStatements.map((statement) => statement.text).join(" ") ||
    (terra.ok
      ? terra.text
      : `Handoff draft unavailable. The coverage case remains pending review.`);
  const handRetrieved = [
    ...session.retrievedSources,
    ...documentation,
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
    statements: generatedStatements.length ? generatedStatements : undefined,
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
  if (session.closing !== "exact_timely") {
    session.closing = "due_now";
  }
  logObligationTransitions(session);
  await draftHandoff(session);
  upsertNeed(session, "coverage_status", {
    flowStep: "human confirm → connect (not yet connected)",
    guidance: "ready",
    answer: {
      title: "Handoff draft — not a connection",
      body: session.handoffDraft,
      sourceLabel: "Governed guidance · scripting · simulated",
    },
  });
  if (requiredWordingOnNow(session)) {
    paintClosingNow(session);
    return;
  }
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
  const connected = confirmedConnection(session);
  const pending = /pending/i.test(status);
  upsertNeed(session, "coverage_status", {
    status: "unresolved_gap",
    flowStep: connected
      ? "connected — case still pending"
      : pending
        ? "telephony pending — not connected"
        : "telephony failed — not connected",
  });
  const connBody = `${session.transfer.transferId ?? "unassigned"}: ${status}. ${
    session.coverage
      ? `${session.coverage.caseId} remains ${session.coverage.status}`
      : "No coverage case is on the session"
  }. Connection is not a coverage determination.`;
  recordActionResult(session, {
    kind: connected ? "transfer_connect" : "transfer_attempt",
    title: "Connection result",
    body: connBody,
    sourceLabel: "System record · telephony · simulated",
    at: new Date().toISOString(),
  });
  await finalizeCall(session, origin, {
    trigger: "transfer_executed",
    terminal: true,
  });
  showNow(session, {
    title: "Connection result",
    body: connBody,
    sourceLabel: "System record · telephony · simulated",
  });
  return { ok: true as const };
}

export function confirmDisposition(session: SessionState, code: string): { ok: boolean; reason?: string } {
  const option = session.disposition.options.find(
    (candidate) => candidate.code === code,
  );
  if (!option) return { ok: false, reason: "code_not_in_governed_document" };
  const safety = dispositionSafety(session, option);
  if (!safety.ok) return safety;
  session.disposition.confirmed = code;
  session.reviewStep = 2;
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

export function recordThumb(
  session: SessionState,
  rec: {
    cardId: string;
    kind: string;
    thumb: "up" | "down";
    reason?: string;
    note?: string;
    sources?: string[];
    tookMs?: number;
    advocateDid?: string;
  },
) {
  const row = session.shownCards.find((c) => c.id === rec.cardId);
  if (row) {
    row.thumb = rec.thumb;
    row.reason = rec.reason;
    row.note = rec.note;
  } else {
    session.shownCards = [
      ...session.shownCards,
      {
        id: rec.cardId,
        kind: rec.kind,
        description: rec.kind,
        thumb: rec.thumb,
        reason: rec.reason,
        note: rec.note,
      },
    ];
  }
  appendJsonl(session.sessionId, {
    kind: "advocate_thumb",
    card: rec.cardId,
    cardKind: rec.kind,
    sources: rec.sources ?? [],
    tookMs: rec.tookMs ?? null,
    advocateDid: rec.advocateDid ?? null,
    thumb: rec.thumb,
    reason: rec.reason ?? null,
    note: rec.note ?? null,
  });
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
  origin?: string,
) {
  const key = `${session.sessionId}:${line.id}`;
  if (appliedLunaTriggers.has(key) && trigger.modelCall) return;
  if (trigger.modelCall) appliedLunaTriggers.add(key);
  // Stage 1 is plain code, stage 2 is luna. Attribute whatever this check moves.
  noteCheckSource(session, "pricing", trigger.modelCall ? "model" : "code");
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
    const greetReq = session.disclosures.find(
      (d) => d.requirementId === "DEMO-GREETING-v1",
    );
    const greetingLine = Boolean(
      greetReq &&
        (isExactReading(line.text, greetReq.verbatimText) ||
          isWordingAttempt(line.text, greetReq.verbatimText)),
    );
    const identityOk =
      session.auth?.decision.toLowerCase() === "valid" ||
      session.identityStatus === "VALID";
    if (greetingLine || !identityOk) {
      /* Greeting speech and pre-auth lines are not price estimates. */
    } else {
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
  }
  if (line.stability === "final" || line.stability === "corrected") {
    if (!trigger.fired || suppressRepeat) assessPricingSpeech(session, line);
  }
  assessClosing(session, line, origin);
  logObligationTransitions(session, { eventId: line.id });
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
  origin?: string,
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
        applyPricingTriggerResult(session, stamped, luna, origin);
        publishSession(session);
      } catch {
        applyPricingTriggerResult(session, stamped, {
          stage: 2,
          fired: false,
          classification: "unable_to_verify",
          latencyMs: 0,
          modelCall: true,
          reason: "luna_trigger_error",
        }, origin);
        publishSession(session);
      }
    })();
    return;
  }
  applyPricingTriggerResult(session, stamped, triggerCode, origin);
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
    // A need first raised by the member's own words records the utterance that
    // raised it. Without that provenance the answer loop cannot file its answer
    // against this need and files an unrecognized request instead.
    if (line.speaker === "member" && !getNeed(session, kind)) {
      upsertNeed(session, kind, {
        status: "active",
        flowStep: step,
        sourceUtteranceId: line.id,
      });
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
    session.callReasonHow = session.callReasonHow ?? "his_words";
    const prior = getNeed(session, "refill_status");
    upsertNeed(session, "refill_status", {
      status: "active",
      guidance: "preparing",
      flowStep: "verify → check existing request",
      sourceUtteranceId: prior?.sourceUtteranceId ?? line.id,
      queryText: preferNeedQueryText(prior?.queryText, line.text),
    });
    focus("refill_status", "verify → check existing request");
  }

  if (
    interp.historicalAsked &&
    line.speaker === "member"
  ) {
    session.callReasonHow = "his_words";
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
        status: hist.answer?.body ? "resolved" : "deferred",
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
    const refill = getNeed(session, "refill_status");
    upsertNeed(session, "refill_status", {
      status: refill?.answer?.body ? refill.status : "active",
      queryText: preferNeedQueryText(refill?.queryText, line.text),
      sourceUtteranceId: refill?.sourceUtteranceId ?? line.id,
    });
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
    seatRecommendation(session, {
      kind: "objection_retail",
      title: "He can keep his pharmacist and still see the prices",
      body,
      sourceLabel: "Governed guidance · scripting · simulated",
      status: "pending",
      pillName: "Reply to a concern",
      advocateControl: "offer_dismiss",
    });
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
    const ph = resolveQuotePharmacyId(
      line.text,
      interp.quotePharmacy,
      sessionPharmacies(session),
    );
    if (!ph) {
      if (interp.quotePharmacyCorrection) {
        showNow(session, {
          title: "Need clarification",
          body: "A pharmacy correction was heard but no known pharmacy id was identified. Withholding quotes.",
          sourceLabel: "Governed guidance · scripting · simulated",
        });
      }
    } else if (ph !== session.quoteFocus?.pharmacyId) {
      upsertNeed(session, "prospective_comparison", {
        status: "active",
        guidance: "preparing",
        flowStep: "compare estimates",
      });
      await requestQuotes(
        session,
        origin,
        ph,
        interp.quoteDrug ?? undefined,
        isNewest,
      );
    } else {
      applyFocusInvalidation(session);
      paintQuotesAttention(session);
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
      await loadCoverage(session, origin, true, line.id, drug);
    }
  }

  if (interp.advocateOfferedTransfer && session.coverage) {
    if (session.closing === "pending_later") session.closing = "due_now";
    if (requiredWordingOnNow(session)) paintClosingNow(session);
  }

  if (interp.memberAgreesTransfer && memberConsentLine(line) && session.coverage) {
    session.transfer.agreedThisCall = true;
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

  if (commitConsent) await maybeCompleteServicing(session, origin);
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
    await maybeCompleteServicing(session, origin);
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
      /delivery for (?:the )?(.+?)(?=\s+(?:and|while)\s+[^.]*\b(?:stays?|remains?)\s+at\s+retail\b|[.;]|$)/i,
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
        sourceUtteranceId: line.id,
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
  await applyAdvocateObligations(session, line, origin);
  const markApplied = () => {
    if (line.stability === "partial") return;
    markEventApplied(session, line.id);
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
  session.activeInterpretations += 1;
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
      if (
        line.speaker === "advocate" &&
        interp.lookupHold &&
        !isInjectedHoldId(line.id) &&
        !requiredWordingOnNow(session) &&
        interp.pricingTrigger === "none" &&
        interp.comparisonConsent === "none" &&
        interp.enrollmentConsent === "none" &&
        !interp.focusKind &&
        interp.refillCheck === "none"
      ) {
        const lastQ = lastUnansweredMemberQuestion(session);
        const inProgress = Boolean(openLookup(session)) && !lookupHasAnswer(session);
        if (lastQ && !inProgress) {
          appendJsonl(session.sessionId, {
            kind: "hold_safety_net",
            eventId: line.id,
            sourceUtteranceId: lastQ.id,
            question: lastQ.text,
          });
          await runMemberQuestionLoop(
            session,
            origin,
            lastQ.text,
            session.needs.find((n) => n.sourceUtteranceId === lastQ.id)?.kind,
            lastQ.id,
          );
        }
      }
      if (line.stability === "partial") {
        const laterFinal = session.transcript.some(
          (t) =>
            t.speaker === "member" &&
            (t.stability === "final" || t.stability === "corrected") &&
            t.receivedAt >
              (session.transcript.find((x) => x.id === line.id)?.receivedAt ?? 0),
        );
        // Early tools only — Terra on the final decides whether a card/item exists.
        if (
          !laterFinal &&
          line.speaker === "member" &&
          needKindFromInterp(interp) &&
          !compatibleLoopRunning(session, line.text)
        ) {
          // Do not block ingest on partial pre-fetch — final owns the card.
          void runMemberQuestionLoop(
            session,
            origin,
            line.text,
            needKindFromInterp(interp),
            undefined,
            { paint: false },
          );
        }
        return;
      }
      await applyInterpretation(
        session,
        origin,
        line,
        interp,
        line.stability === "final" || line.stability === "corrected",
        { seq, consentAnchor },
      );
      logObligationTransitions(session, { eventId: line.id });
      if (line.speaker === "member") markApplied();
      if (
        line.speaker === "member" &&
        (line.stability === "final" || line.stability === "corrected")
      ) {
        const owned = session.needs.find((n) => n.sourceUtteranceId === line.id);
        if (interp.returnToHistorical) {
          // resumeParkedNeed already ran from interpretation
        } else if (compatibleLoopRunning(session, line.text)) {
          const a = session.answerLoopAnchor;
          if (a) {
            a.sourceUtteranceId = line.id;
            a.question = line.text;
          }
          if (owned?.kind || session.answerLoopAnchor?.needKind) {
            upsertNeed(
              session,
              owned?.kind ?? session.answerLoopAnchor!.needKind!,
              {
                queryText: line.text,
                sourceUtteranceId: line.id,
              },
            );
          }
          appendJsonl(session.sessionId, {
            kind: "lookup_reused_partial",
            eventId: line.id,
            question: line.text,
          });
        } else {
          const waiting = waitingNeedMatchingUtterance(session, line.text);
          const parked = waiting ? getNeed(session, waiting) : undefined;
          // Only resume a prior parked need. A need just created for THIS line
          // (preparing, no answer) must run Terra — not resumeParkedNeed, which
          // returns immediately when queryText/answer are missing.
          const resumePrior =
            Boolean(parked) &&
            (needHasRealAnswer(parked) ||
              (Boolean(parked?.queryText) &&
                parked?.sourceUtteranceId !== line.id));
          if (waiting && resumePrior) {
            await resumeParkedNeed(session, origin, waiting);
          } else {
            // Do not await Terra here — the T01 transcript races an interrupt
            // while the metformin lookup is still in flight. Playback pacing is
            // streamHold (owns-Now lookup + say dwell); late answers park.
            void runMemberQuestionLoop(
              session,
              origin,
              line.text,
              owned?.kind ?? needKindFromInterp(interp),
              line.id,
            );
          }
        }
      }
      publishSession(session);
  } finally {
      session.activeInterpretations = Math.max(
        0,
        session.activeInterpretations - 1,
      );
      if (line.speaker !== "advocate") markApplied();
      publishSession(session);
  }
}
