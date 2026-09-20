import { isExactReading, isWordingAttempt, stitchedReading } from "@/lib/exactness";
import { appendJsonl } from "@/lib/log";
import type {
  AuthResult,
  DisclosureRequirement,
  MemberBrief,
  NeedKind,
  NeedRecord,
  RouterTrace,
  SessionState,
  TranscriptLine,
  TriggerTrace,
} from "@/lib/types";
import type { UtteranceRules } from "@/lib/utteranceRules";
import { randomUUID } from "crypto";

const g = globalThis as unknown as { __haaSessions?: Map<string, SessionState> };
g.__haaSessions ??= new Map<string, SessionState>();
const sessions = g.__haaSessions;

function now() {
  return Date.now();
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function beginAnswerLoop(
  session: SessionState,
  question: string,
): number {
  const generation = session.answerLoopGeneration + 1;
  session.answerLoopGeneration = generation;
  session.answerLoopAnchor = {
    generation,
    question,
    enrollmentConsent: session.consent.enrollment,
    enrollmentScopeKey: session.enrollment.medications.join("|"),
  };
  session.pendingNba = null;
  session.nowCard = {
    ...session.nowCard,
    liveSteps: [],
    earlyFacts: [],
  };
  return generation;
}

export function shouldApplyAnswerLoop(
  session: SessionState,
  generation: number,
): boolean {
  const a = session.answerLoopAnchor;
  if (!a || a.generation !== generation) return false;
  if (session.answerLoopGeneration !== generation) return false;
  if (session.consent.enrollment !== a.enrollmentConsent) return false;
  if (session.enrollment.medications.join("|") !== a.enrollmentScopeKey) {
    return false;
  }
  return true;
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
    nowCard: {
      title: "Opening",
      body: "Recorded-line greeting is due. Exact wording is on the obligation rail. No member record until the caller is verified.",
      sourceLabel: "Plan rules",
    },
    recommendation: null,
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
    },
    disposition: {
      recommended: null,
      confirmed: null,
    },
    closingNote: null,
    closingHistory: [],
    outcomeReady: false,
    warmup: null,
    lastTimings: [],
    lunaSeq: 0,
    lastInterpretation: null,
    lastAppliedEventId: null,
    answerLoopGeneration: 0,
    answerLoopAnchor: null,
    pendingNba: null,
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
  appendJsonl(sessionId, {
    kind: "session_start",
    sessionId,
    overlay,
    scenarioId: state.scenarioId,
    warmup: "pending_fire_and_forget",
    disclosureFetch: init.disclosureFetch,
  });
  return state;
}

export function recordWarmup(
  sessionId: string,
  warmup: NonNullable<SessionState["warmup"]>,
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.warmup = warmup;
  session.diagnostics.warmup = `luna warmup ${warmup.ok ? "ok" : "fail"} ${Math.round(warmup.ms)}ms (async, after connect)`;
  appendJsonl(sessionId, { kind: "luna_warmup", ...warmup });
}

export function recordEmbeddings(
  sessionId: string,
  info: { ready: boolean; count: number; model: string },
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.diagnostics.embeddings = info.ready
    ? `docs embedded once at startup: ${info.count} (${info.model})`
    : `doc embeddings not ready (${info.model})`;
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
    if (session.ivrReason && !late) {
      session.nowCard = {
        title: "Phone menu",
        body: `Provisional hint: ${session.ivrReason}. Not identity evidence. Greeting matched on the rail.`,
        sourceLabel: "Phone menu",
      };
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
    tEvent: receivedAt,
  });
  applyGreeting(session, next);
}

export function setIvrHint(session: SessionState, ivrReason: string) {
  session.ivrReason = ivrReason;
  if (/refill/i.test(ivrReason)) session.callType = "Refill";
  else if (/pric/i.test(ivrReason)) session.callType = "Pricing";
  session.nowCard = {
    title: "Phone menu",
    body: `Provisional hint: ${ivrReason}. Not identity evidence. Greeting still due.`,
    sourceLabel: "Phone menu",
  };
  appendJsonl(session.sessionId, { kind: "ivr_hint", ivrReason });
}

export function beginPause(session: SessionState, label: string) {
  if (session.paused) return;
  session.paused = true;
  session.pauseStartedAt = now();
  session.lastPauseLabel = label;
  const hist = session.needs.find((n) => n.kind === "historical_price");
  session.diagnostics.pauseSnapshots.push({
    label,
    nowTitle: session.nowCard.title,
    historicalGuidance: hist?.guidance ?? null,
    historicalStatus: hist?.status ?? null,
  });
  appendJsonl(session.sessionId, {
    kind: "pause_started",
    label,
    tEvent: session.pauseStartedAt,
    excludedFromMachineTime: true,
    nowTitle: session.nowCard.title,
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
  session.flowStep = "listening";
  session.currentNeed = "listening";
  if (member && auth.decision.toLowerCase() === "valid") {
    session.nowCard = {
      title: "Caller verified",
      body: `${member.name.given} ${member.name.family} · ${member.lineOfBusiness}. Member details are available.`,
      sourceLabel: "Eligibility",
    };
  }
  appendJsonl(session.sessionId, {
    kind: "authorization",
    source: "stream_system_event",
    auth,
  });
}

export function upsertNeed(
  session: SessionState,
  kind: NeedKind,
  patch: Partial<NeedRecord>,
) {
  const idx = session.needs.findIndex((n) => n.kind === kind);
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

export function getNeed(session: SessionState, kind: NeedKind) {
  return session.needs.find((n) => n.kind === kind);
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

function focusMatches(currentNeed: string, kind: NeedKind) {
  return currentNeed.replace(/_/g, " ") === kind.replace(/_/g, " ");
}

/** Required DEMO-PRICING-v1 wording occupies Now (due now, late, or paraphrased until exact). */
export function requiredPricingOnNow(session: SessionState): boolean {
  return (
    !session.pricingExactDelivered &&
    (session.pricing === "due_now" ||
      session.pricing === "late_finding" ||
      session.pricing === "paraphrased")
  );
}

function isPricingWordingCard(
  card: SessionState["nowCard"],
  opts?: { priority?: NowPriorityKind },
) {
  return (
    opts?.priority === "due_now" || card.title === "Pricing statement due now"
  );
}

/** Blocking rank from live conditions. Due-now required wording always outranks clarify, answers, and recommendations (§14 / D11). */
export function blockingNowPriority(session: SessionState): number {
  const closingOpen =
    session.closing === "paraphrased" || session.closing === "unable_to_verify";
  if (requiredPricingOnNow(session)) return NOW_PRIORITY.due_now;
  if (session.nudge || closingOpen) return NOW_PRIORITY.nudge;
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
    requiredPricingOnNow(session) &&
    !isPricingWordingCard(card, opts) &&
    priority < NOW_PRIORITY.due_now
  ) {
    if (kind) {
      upsertNeed(session, kind, {
        answer: {
          title: card.title,
          body: card.body,
          sourceLabel: card.sourceLabel,
        },
      });
    }
    return;
  }
  if (requiredPricingOnNow(session) && isPricingWordingCard(card, opts)) {
    session.nowCard = card;
    session.nowPriority = NOW_PRIORITY.due_now;
    return;
  }
  const block = blockingNowPriority(session);
  session.nowPriority = block;
  if (kind && !focusMatches(session.currentNeed, kind) && priority <= NOW_PRIORITY.answer) {
    upsertNeed(session, kind, {
      answer: {
        title: card.title,
        body: card.body,
        sourceLabel: card.sourceLabel,
      },
    });
    return;
  }
  if (priority < block && block >= NOW_PRIORITY.due_now) {
    if (kind) {
      upsertNeed(session, kind, {
        answer: {
          title: card.title,
          body: card.body,
          sourceLabel: card.sourceLabel,
        },
      });
    }
    return;
  }
  session.nowCard = card;
  session.nowPriority = Math.max(priority, block);
}

export { sessions };
