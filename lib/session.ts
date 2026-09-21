import { NUDGE_PARAPHRASE } from "@/lib/copy";
import { isExactReading, isWordingAttempt, stitchedReading, wordDiff } from "@/lib/exactness";
import { appendJsonl } from "@/lib/log";
import {
  requiredPricingOnNow,
  requiredWordingOnNow,
} from "@/lib/nowOccupancy";
import type {
  ActionResult,
  AuthResult,
  DisclosureRequirement,
  MemberBrief,
  NeedAnswer,
  NeedKind,
  NeedRecord,
  RouterTrace,
  SessionState,
  TranscriptLine,
  TriggerTrace,
} from "@/lib/types";
import {
  lookupHasAnswer,
  openLookup,
} from "@/lib/lookupProgress";
import { logObligationTransitions } from "@/lib/obligationLog";
import type { UtteranceRules } from "@/lib/utteranceRules";
import { randomUUID } from "crypto";

const g = globalThis as unknown as { __haaSessions?: Map<string, SessionState> };
g.__haaSessions ??= new Map<string, SessionState>();
const sessions = g.__haaSessions;
const MAX_IN_MEMORY_SESSIONS = 64;

function now() {
  return Date.now();
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

const NEED_KINDS: NeedKind[] = [
  "refill_status",
  "historical_price",
  "prospective_comparison",
  "service_education",
  "service_election",
  "coverage_status",
  "unrecognized_request",
  "unsupported_work",
];

export function parseNeedKind(raw: string | undefined | null): NeedKind | undefined {
  if (!raw) return undefined;
  const k = raw.trim().replace(/\s+/g, "_") as NeedKind;
  return NEED_KINDS.includes(k) ? k : undefined;
}

function parkCardOnNeed(session: SessionState, kind: NeedKind) {
  if (session.nowCardOrigin !== "answer") return;
  if (session.nowCardNeedKind && session.nowCardNeedKind !== kind) return;
  const card = session.nowCard;
  if (!card.body && !card.title) return;
  if (nowCardIsLookupPlaceholder(card)) {
    upsertNeed(session, kind, {
      status: "deferred",
      guidance: getNeed(session, kind)?.answer?.body
        ? "deferred_valid"
        : "preparing",
      flowStep:
        getNeed(session, kind)?.flowStep ||
        "waiting while another question is on Now",
    });
    appendJsonl(session.sessionId, {
      kind: "answer_parked",
      needKind: kind,
      nowTitle: card.title,
      waiting: true,
      placeholder: true,
    });
    return;
  }
  recordNeedAnswer(session, kind, {
    title: card.title,
    body: card.body,
    sourceLabel: card.sourceLabel,
    statements: card.statements,
    usedSources: card.usedSources,
  }, {
    status: card.body ? "resolved" : "deferred",
    guidance: card.body ? "deferred_valid" : "preparing",
  });
  appendJsonl(session.sessionId, {
    kind: "answer_parked",
    needKind: kind,
    nowTitle: card.title,
    waiting: true,
  });
}

export function recordNeedAnswer(
  session: SessionState,
  kind: NeedKind,
  answer: NeedAnswer,
  extra?: Partial<NeedRecord>,
  sourceUtteranceId?: string,
) {
  const existing = getNeed(session, kind, sourceUtteranceId);
  const prev = existing?.answer;
  const history = [...(existing?.answerHistory ?? [])];
  if (prev && (prev.body !== answer.body || prev.title !== answer.title)) {
    history.push({ ...prev, at: prev.at ?? new Date().toISOString() });
  }
  const stamped = { ...answer, at: answer.at ?? new Date().toISOString() };
  upsertNeed(session, kind, {
    ...extra,
    sourceUtteranceId: sourceUtteranceId ?? existing?.sourceUtteranceId,
    answer: stamped,
    answerHistory: history.slice(-8),
  });
}

export function recordActionResult(session: SessionState, rec: ActionResult) {
  session.actionResults = [...session.actionResults, rec].slice(-12);
  session.nowCardOrigin = "action";
  session.nowCardNeedKind = null;
  const { kind: actionKind, ...detail } = rec;
  appendJsonl(session.sessionId, {
    kind: "action_result",
    actionKind,
    ...detail,
  });
}

export function beginAnswerLoop(
  session: SessionState,
  question: string,
  needKind?: NeedKind,
  sourceUtteranceId?: string,
): number {
  const prevKind =
    session.answerLoopAnchor?.needKind ??
    session.nowCardNeedKind ??
    undefined;
  const keepNow =
    Boolean(openLookup(session)) &&
    !lookupHasAnswer(session) &&
    session.nowCardOrigin === "answer" &&
    Boolean(session.answerLoopAnchor?.question) &&
    session.answerLoopAnchor!.question !== question;
  if (needKind && !requiredWordingOnNow(session)) {
    if (
      prevKind &&
      prevKind !== needKind &&
      session.nowCardOrigin === "answer"
    ) {
      // File the visible answer on its need. Leave Now as-is — Terra replaces
      // the card only when it judges need:answer; need:nothing keeps it.
      parkCardOnNeed(session, prevKind);
    }
    if (!keepNow) {
      // Do not set nowCardNeedKind yet — that would let paintStep decorate the
      // prior answer while Terra is still judging this line.
      session.rightNowLine = question;
    }
  }
  const generation = keepNow
    ? session.answerLoopGeneration || 1
    : session.answerLoopGeneration + 1;
  if (!keepNow) session.answerLoopGeneration = generation;
  session.answerLoopAnchor = keepNow
    ? session.answerLoopAnchor
    : {
        generation,
        question,
        needKind,
        sourceUtteranceId,
        enrollmentConsent: session.consent.enrollment,
        enrollmentScopeKey: session.enrollment.medications.join("|"),
      };
  if (!keepNow) session.pendingNba = null;
  return generation;
}

export function shouldApplyAnswerLoop(
  session: SessionState,
  generation: number,
): boolean {
  if (session.callEnd.ended) return false;
  const a = session.answerLoopAnchor;
  if (!a || a.generation !== generation) return false;
  if (session.answerLoopGeneration !== generation) return false;
  if (session.consent.enrollment !== a.enrollmentConsent) return false;
  if (session.enrollment.medications.join("|") !== a.enrollmentScopeKey) {
    return false;
  }
  return true;
}

/** Paint this answer on Now if the loop is current, or Now is still looking up this question. */
export function shouldPaintAnswerOntoNow(
  session: SessionState,
  opts: { generation: number; needKind?: NeedKind; question?: string },
) {
  if (blockingNowPriority(session) >= NOW_PRIORITY.due_now) return false;
  const current =
    shouldApplyAnswerLoop(session, opts.generation) || opts.generation === 0;
  if (current) return true;
  if (!nowCardIsLookupPlaceholder(session.nowCard)) return false;
  if (session.nowCardOrigin === "answer") {
    if (
      opts.needKind &&
      session.nowCardNeedKind &&
      opts.needKind !== session.nowCardNeedKind
    ) {
      return false;
    }
    return true;
  }
  if (opts.needKind && session.nowCardNeedKind === opts.needKind) return true;
  if (opts.question && session.nowCard.body === opts.question) return true;
  return false;
}

export function publicState(session: SessionState): SessionState {
  const elapsed = Math.max(
    0,
    now() -
      session.startedAt -
      session.totalPauseMs -
      (session.paused && session.pauseStartedAt
        ? now() - session.pauseStartedAt
        : 0),
  );
  return { ...session, elapsedMs: elapsed };
}

export function createSession(init: {
  disclosures: DisclosureRequirement[];
  disclosureFetch: string;
  overlay?: string | null;
  scenarioId?: string;
  injectedDelayMs?: number;
  utteranceRules?: UtteranceRules | null;
  selectedMemberId?: string;
}): SessionState {
  const sessionId = randomUUID();
  const overlay = init.overlay ?? null;
  const state: SessionState = {
    sessionId,
    startedAt: now(),
    elapsedMs: 0,
    paused: false,
    pauseStartedAt: null,
    totalPauseMs: 0,
    lastPauseLabel: null,
    overlay,
    selectedMemberId: init.selectedMemberId ?? "DEMO-M001",
    scenarioId: init.scenarioId ?? "t01_m2a",
    injectedDelayMs: init.injectedDelayMs ?? 0,
    pricingExactDelivered: false,
    prefetch: null,
    callType: "General inquiry / unclassified",
    currentNeed: "opening",
    flowStep: "verify greeting → await identity",
    nowPriority: 0,
    greetingLocked: false,
    closingLocked: false,
    greetingBuffer: null,
    greetingDeadlineAt: null,
    pricingExactOffset: null,
    identityStatus: "unverified",
    auth: null,
    member: null,
    ivrReason: null,
    greeting: "due_now",
    pricing: "not_applicable",
    closing: "not_applicable",
    greetingSource: "GET /api/simulated/scripting/disclosures",
    disclosures: init.disclosures,
    utteranceRules: init.utteranceRules ?? null,
    transcript: [],
    needs: [],
    actionResults: [],
    nowCardOrigin: "system",
    nowCard: {
      title: "Recorded-line greeting due now",
      body:
        init.disclosures.find((d) => d.requirementId === "DEMO-GREETING-v1")
          ?.verbatimText ??
        "Recorded-line greeting is due. Exact wording is on the obligation rail. No member record until the caller is verified.",
      sourceLabel: "Governed guidance · scripting · simulated",
    },
    recommendation: null,
    waitingRecommendations: [],
    quotes: [],
    quoteFocus: null,
    quoteGeneration: 0,
    optionalWorkSuppressed: false,
    nbaDismissedThisCall: false,
    consent: {
      comparison: "none",
      enrollment: "none",
      clarification: null,
      comparisonScopeKey: null,
      enrollmentScopeKey: null,
      comparisonUtteranceId: null,
      enrollmentUtteranceId: null,
      clarificationShown: false,
    },
    nudge: null,
    pricingNote: null,
    serviceDiscussed: false,
    estimateSpokenWithoutReading: false,
    enrollment: {
      medications: [],
      readback: "",
      confirmed: false,
      submitted: false,
      resultId: null,
      returnedScope: null,
      scopeOk: null,
      withdrawn: false,
      scopeChangedAt: 0,
    },
    coverage: null,
    handoffDraft: "",
    wrapDraft: "",
    wrapStable: "",
    flaggedIssues: [],
    openEvidence: null,
    retrievedSources: [],
    transfer: {
      destinationConfirmed: false,
      connectionStatus: null,
      transferId: null,
      agreedThisCall: false,
    },
    disposition: {
      recommended: null,
      confirmed: null,
      reasons: [],
      documentId: null,
      options: [],
    },
    callEnd: {
      triggered: false,
      ended: false,
      finalizing: false,
      trigger: null,
      endedAt: null,
      hangupId: null,
      wrapMs: null,
    },
    presenterInput: {
      maxLength: 500,
      lastSource: null,
      truncatedFrom: null,
    },
    closingNote: null,
    closingHistory: [],
    outcomeReady: false,
    rightNowLine: "Call connected — greet the caller",
    callReasonHow: null,
    reviewStep: 0,
    shownCards: [],
    warmup: null,
    lastTimings: [],
    lunaSeq: 0,
    lastInterpretation: null,
    lastAppliedEventId: null,
    appliedEventIds: [],
    lastAnswerQuestion: null,
    nowCardNeedKind: null,
    modelHealth: { luna: null, terra: null },
    answerLoopGeneration: 0,
    activeInterpretations: 0,
    answerLoopAnchor: null,
    pendingNba: null,
    lookupProgress: [],
    heldAdvocateLines: [],
    diagnostics: {
      disclosureFetch: init.disclosureFetch,
      warmup: "luna warmup started fire-and-forget at connect (not awaited)",
      embeddings: "document embeddings started at connect",
      overlay: overlay ?? "none",
      pauses: [],
      router: [],
      triggers: [],
      rechecks: [],
      needPaths: [],
      pauseSnapshots: [],
      nba: [],
    },
  };
  sessions.set(sessionId, state);
  while (sessions.size > MAX_IN_MEMORY_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (!oldest || oldest === sessionId) break;
    sessions.delete(oldest);
  }
  appendJsonl(sessionId, {
    kind: "session_start",
    sessionId,
    overlay,
    scenarioId: state.scenarioId,
    warmup: "pending_fire_and_forget",
    disclosureFetch: init.disclosureFetch,
  });
  logObligationTransitions(state);
  return state;
}

export function recordWarmup(
  sessionId: string,
  warmup: NonNullable<SessionState["warmup"]>,
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.warmup = warmup;
  session.diagnostics.warmup = `luna warmup ${warmup.ok ? "ok" : "fail"} ${Math.round(warmup.ms)}ms status=${warmup.httpStatus ?? "?"} (async, after connect)`;
  appendJsonl(sessionId, { kind: "luna_warmup", ...warmup });
}

export function recordEmbeddings(
  sessionId: string,
  info: {
    ready: boolean;
    count: number;
    model: string;
    httpStatus?: number;
    error?: string | null;
    ms?: number;
  },
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.diagnostics.embeddings = info.ready
    ? `docs embedded once at startup: ${info.count} (${info.model})`
    : `doc embeddings not ready (${info.model}) status=${info.httpStatus ?? "?"} ${info.error ?? ""}`.trim();
  appendJsonl(sessionId, { kind: "document_embeddings", ...info });
}

export function recordClientPaint(
  session: SessionState,
  rec: { eventId: string; kind: string; tEvent: number; tPaint: number },
) {
  const paintMs = rec.tPaint - rec.tEvent;
  const measured = Number.isFinite(paintMs) && paintMs > 0;
  const timing = {
    eventId: rec.eventId,
    kind: rec.kind,
    tEvent: rec.tEvent,
    tPaint: rec.tPaint,
    paintMs: measured ? paintMs : null,
    measured,
    excludedPauseMs: session.totalPauseMs,
  };
  session.lastTimings = [...session.lastTimings, timing];
  appendJsonl(session.sessionId, {
    ...timing,
    kind: "event_to_client_paint",
    eventKind: rec.kind,
    unmeasured: measured ? undefined : true,
  });
}

function greetingRequirement(session: SessionState) {
  return session.disclosures.find((d) => d.requirementId === "DEMO-GREETING-v1");
}

function applyGreeting(session: SessionState, line: TranscriptLine) {
  if (line.speaker === "member" && line.stability === "final") {
    if (session.greetingDeadlineAt == null) {
      session.greetingDeadlineAt = line.receivedAt;
    }
  }
  if (line.speaker !== "advocate") return;
  if (line.stability === "partial") return;
  const req = greetingRequirement(session);
  if (!req) return;
  if (session.greetingLocked && session.greeting === "exact_timely") return;
  if (line.stability === "uncertain") {
    if (!session.greetingLocked) session.greeting = "unable_to_verify";
    return;
  }
  const combined = stitchedReading(session.transcript, line, req.verbatimText);
  session.greetingBuffer = {
    speaker: "advocate",
    parts: combined.split(/\s+/).length ? [combined] : [line.text],
    lastId: line.id,
  };
  if (isExactReading(line.text, req.verbatimText) || isExactReading(combined, req.verbatimText)) {
    const late =
      session.greetingDeadlineAt != null ||
      session.identityStatus === "VALID" ||
      Boolean(session.auth);
    session.greeting = late ? "late_finding" : "exact_timely";
    session.greetingLocked = true;
    session.flowStep = "greeting verified · await identity";
    if (session.nudge?.requiredText === req.verbatimText) {
      session.nudge = null;
    }
    appendJsonl(session.sessionId, {
      kind: "greeting_verified",
      eventId: line.id,
      timely: !late,
      note: "paint timing recorded separately as event_to_client_paint",
    });
    return;
  }
  if (!session.greetingLocked && isWordingAttempt(combined, req.verbatimText)) {
    session.greeting = "paraphrased";
    const diff = wordDiff(combined, req.verbatimText);
    session.nudge = {
      template: NUDGE_PARAPHRASE,
      heard: combined,
      requiredText: req.verbatimText,
      missingFromHeard: diff.missingFromHeard,
      extraInHeard: diff.extraInHeard,
    };
    showNow(
      session,
      {
        title: "Recorded-line greeting due now",
        body: req.verbatimText,
        sourceLabel: "Governed guidance · scripting · simulated",
      },
      { priority: "due_now" },
    );
  }
}

export function ingestTranscript(
  session: SessionState,
  line: Omit<TranscriptLine, "receivedAt">,
  clientT?: number,
) {
  const receivedAt = clientT ?? now();
  const next: TranscriptLine = { ...line, receivedAt };
  session.transcript = [...session.transcript, next];
  appendJsonl(session.sessionId, {
    kind: "transcript",
    eventId: line.id,
    speaker: line.speaker,
    stability: line.stability,
    text: line.text,
    inputSource: line.inputSource ?? "stream",
    truncatedFrom: line.truncatedFrom ?? null,
    tEvent: receivedAt,
  });
  applyGreeting(session, next);
  logObligationTransitions(session, { eventId: line.id });
}

export function setIvrHint(session: SessionState, ivrReason: string) {
  session.ivrReason = ivrReason;
  if (!session.callReasonHow) session.callReasonHow = "phone_menu";
  if (/refill/i.test(ivrReason)) session.callType = "Refill";
  else if (/pric/i.test(ivrReason)) session.callType = "Pricing";
  if (!requiredWordingOnNow(session)) {
    session.nowCard = {
      title: "Phone menu",
      body: `Provisional hint: ${ivrReason}. Not identity evidence. Greeting still due.`,
      sourceLabel: "Phone menu",
    };
  }
  appendJsonl(session.sessionId, { kind: "ivr_hint", ivrReason });
}

export function markEventApplied(session: SessionState, eventId: string) {
  session.lastAppliedEventId = eventId;
  if (!session.appliedEventIds) session.appliedEventIds = [];
  if (!session.appliedEventIds.includes(eventId)) {
    session.appliedEventIds = [...session.appliedEventIds, eventId].slice(-80);
  }
}

export function beginPause(session: SessionState, label: string) {
  if (session.paused) return;
  session.paused = true;
  session.pauseStartedAt = now();
  session.lastPauseLabel = label;
  const hist = [...session.needs]
    .reverse()
    .find((n) => n.kind === "historical_price");
  session.diagnostics.pauseSnapshots.push({
    label,
    nowTitle: session.nowCard.title,
    nowBody: session.nowCard.body,
    historicalGuidance: hist?.guidance ?? null,
    historicalStatus: hist?.status ?? null,
  });
  appendJsonl(session.sessionId, {
    kind: "pause_started",
    label,
    tEvent: session.pauseStartedAt,
    excludedFromMachineTime: true,
    nowTitle: session.nowCard.title,
    nowBody: session.nowCard.body,
    historicalGuidance: hist?.guidance ?? null,
    historicalStatus: hist?.status ?? null,
  });
}

export function endPause(session: SessionState) {
  if (!session.paused || session.pauseStartedAt == null) return;
  const ended = now();
  const durationMs = ended - session.pauseStartedAt;
  session.totalPauseMs += durationMs;
  session.diagnostics.pauses.push({
    label: "presenter_gate",
    durationMs,
  });
  session.paused = false;
  session.pauseStartedAt = null;
  appendJsonl(session.sessionId, {
    kind: "pause_ended",
    durationMs,
    excludedFromMachineTime: true,
    tEvent: ended,
  });
}

export function applyAuth(
  session: SessionState,
  auth: AuthResult,
  member: MemberBrief | null,
) {
  const greetingReq = greetingRequirement(session);
  const greetingCardOpen = Boolean(
    greetingReq &&
      (/recorded-line greeting/i.test(session.nowCard.title) ||
        session.nowCard.body === greetingReq.verbatimText),
  );
  session.auth = auth;
  session.member = member;
  session.identityStatus =
    auth.decision.toLowerCase() === "valid" ? "VALID" : auth.decision;
  if (session.greetingDeadlineAt == null) {
    session.greetingDeadlineAt = now();
  }
  if (session.greeting === "due_now" && !session.greetingLocked) {
    session.greeting = "late_finding";
  }
  // Paraphrased greeting is no longer due after identity — same as unread due_now.
  if (session.greeting === "paraphrased" && !session.greetingLocked) {
    session.greeting = "late_finding";
  }
  if (
    session.identityStatus === "VALID" &&
    greetingReq &&
    session.nudge?.requiredText === greetingReq.verbatimText
  ) {
    session.nudge = null;
  }
  if (session.identityStatus === "VALID" && greetingCardOpen) {
    session.nowCard = { title: "", body: "", sourceLabel: "" };
    session.nowCardOrigin = "system";
    session.nowCardNeedKind = null;
    session.nowPriority = 0;
  }
  session.flowStep = "listening";
  session.currentNeed = "listening";
  appendJsonl(session.sessionId, {
    kind: "authorization",
    source: "stream_system_event",
    auth,
  });
  logObligationTransitions(session);
}

export function upsertNeed(
  session: SessionState,
  kind: NeedKind,
  patch: Partial<NeedRecord>,
) {
  let idx = -1;
  if (patch.sourceUtteranceId) {
    idx = session.needs.findIndex(
      (need) =>
        need.kind === kind &&
        need.sourceUtteranceId === patch.sourceUtteranceId,
    );
    if (idx < 0) {
      idx = session.needs.findIndex(
        (need) => need.kind === kind && !need.sourceUtteranceId,
      );
    }
  } else {
    for (let i = session.needs.length - 1; i >= 0; i -= 1) {
      if (session.needs[i].kind === kind) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    session.needs = [
      ...session.needs,
      {
        kind,
        status: "requested",
        guidance: "preparing",
        flowStep: "",
        ...patch,
      },
    ];
  } else {
    session.needs[idx] = { ...session.needs[idx], ...patch };
  }
}

export function nowCardIsLookupPlaceholder(card: {
  title?: string;
  body?: string;
} | undefined) {
  if (/^working on it$/i.test(card?.title ?? "")) return true;
  if (/^still checking$/i.test(card?.title ?? "")) return true;
  const body = (card?.body ?? "").trim();
  return !body && Boolean(card?.title);
}

export function getNeed(
  session: SessionState,
  kind: NeedKind,
  sourceUtteranceId?: string,
) {
  if (sourceUtteranceId) {
    const exact = session.needs.find(
      (need) =>
        need.kind === kind &&
        need.sourceUtteranceId === sourceUtteranceId,
    );
    if (exact) return exact;
  }
  for (let i = session.needs.length - 1; i >= 0; i -= 1) {
    if (session.needs[i].kind === kind) return session.needs[i];
  }
  return undefined;
}

export function setFocus(session: SessionState, kind: NeedKind, flowStep: string) {
  session.currentNeed = kind.replace(/_/g, " ");
  session.flowStep = flowStep;
  upsertNeed(session, kind, { status: "active" });
}

export function pushRouterTrace(session: SessionState, trace: RouterTrace) {
  session.diagnostics.router = [...session.diagnostics.router, trace].slice(-12);
  appendJsonl(session.sessionId, { kind: "lookup_trace", ...trace });
}

export function pushTriggerTrace(session: SessionState, trace: TriggerTrace) {
  session.diagnostics.triggers = [
    ...session.diagnostics.triggers,
    trace,
  ].slice(-20);
  appendJsonl(session.sessionId, { kind: "trigger_classification", ...trace });
}

export const NOW_PRIORITY = {
  info: 5,
  answer: 10,
  due_now: 30,
  nudge: 40,
} as const;

export type NowPriorityKind = keyof typeof NOW_PRIORITY;

export function needFocusIsIdle(currentNeed: string | null | undefined) {
  const n = (currentNeed ?? "").replace(/_/g, " ").trim();
  return !n || n === "opening" || n === "listening";
}

function focusMatches(currentNeed: string, kind: NeedKind) {
  if (needFocusIsIdle(currentNeed)) return true;
  return currentNeed.replace(/_/g, " ") === kind.replace(/_/g, " ");
}

export { requiredPricingOnNow, requiredWordingOnNow };

/** Strip answers, facts, and live steps while a required statement owns Now. */
export function guardNowWording(session: SessionState) {
  if (!requiredWordingOnNow(session)) return;
  session.nowCard = {
    ...session.nowCard,
    liveSteps: [],
    earlyFacts: [],
    statements: undefined,
    usedSources: undefined,
  };
}

function isRequiredWordingCard(
  card: SessionState["nowCard"],
  opts?: { priority?: NowPriorityKind },
) {
  if (opts?.priority === "due_now" || opts?.priority === "nudge") return true;
  return /due now|could not be verified/i.test(card.title);
}

/** Blocking rank from live conditions. Due-now required wording always outranks clarify, answers, and recommendations (§14 / D11). */
export function blockingNowPriority(session: SessionState): number {
  if (requiredWordingOnNow(session)) return NOW_PRIORITY.due_now;
  if (session.nudge) return NOW_PRIORITY.nudge;
  return 0;
}

export function showNow(
  session: SessionState,
  card: SessionState["nowCard"],
  opts?: { priority?: NowPriorityKind; needKind?: NeedKind },
) {
  const priority = NOW_PRIORITY[opts?.priority ?? "answer"];
  const kind = opts?.needKind;
  if (
    requiredWordingOnNow(session) &&
    !isRequiredWordingCard(card, opts) &&
    priority < NOW_PRIORITY.due_now
  ) {
    if (kind) {
      recordNeedAnswer(session, kind, {
        title: card.title,
        body: card.body,
        sourceLabel: card.sourceLabel,
        statements: card.statements,
        usedSources: card.usedSources,
      });
    }
    return;
  }
  if (requiredWordingOnNow(session) && isRequiredWordingCard(card, opts)) {
    session.nowCard = {
      ...card,
      liveSteps: [],
      earlyFacts: [],
      statements: undefined,
      usedSources: undefined,
    };
    session.nowCardOrigin = "system";
    session.nowCardNeedKind = null;
    session.nowPriority = NOW_PRIORITY.due_now;
    return;
  }
  const block = blockingNowPriority(session);
  session.nowPriority = block;
  const placeholderForKind =
    Boolean(kind) &&
    session.nowCardNeedKind === kind &&
    nowCardIsLookupPlaceholder(session.nowCard);
  if (
    kind &&
    !focusMatches(session.currentNeed, kind) &&
    priority <= NOW_PRIORITY.answer &&
    !placeholderForKind
  ) {
    recordNeedAnswer(session, kind, {
      title: card.title,
      body: card.body,
      sourceLabel: card.sourceLabel,
      statements: card.statements,
      usedSources: card.usedSources,
    });
    return;
  }
  if (priority < block && block >= NOW_PRIORITY.due_now) {
    if (kind) {
      recordNeedAnswer(session, kind, {
        title: card.title,
        body: card.body,
        sourceLabel: card.sourceLabel,
        statements: card.statements,
        usedSources: card.usedSources,
      });
    }
    return;
  }
  session.nowCard = card;
  session.nowCardNeedKind = kind ?? session.nowCardNeedKind ?? null;
  session.nowCardOrigin =
    kind || opts?.priority === "answer" || Boolean((card.body ?? "").trim())
      ? "answer"
      : "system";
  session.nowPriority = Math.max(priority, block);
}

export { sessions };
