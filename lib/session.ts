import { isExactReading } from "@/lib/exactness";
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
    scenarioId: init.scenarioId ?? "t01_m2a",
    injectedDelayMs: init.injectedDelayMs ?? 0,
    pricingExactDelivered: false,
    prefetch: null,
    callType: "Refill",
    currentNeed: "opening",
    flowStep: "verify greeting → await identity",
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
      body: "Recorded-line greeting is due. Exact wording is on the obligation rail (not a Now card). No member record until simulated authorization.",
      sourceLabel: "Governed guidance · scripting · simulated",
    },
    recommendation: null,
    quotes: [],
    quoteFocus: null,
    quoteGeneration: 0,
    optionalWorkSuppressed: false,
    consent: {
      comparison: "none",
      enrollment: "none",
      clarification: null,
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
    },
    coverage: null,
    handoffDraft: "",
    wrapDraft: "",
    wrapStable: "",
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
    excludedPauseMs: 0,
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
  if (line.speaker !== "advocate") return;
  if (line.stability === "partial" || line.stability === "uncertain") return;
  const req = greetingRequirement(session);
  if (!req) return;
  if (isExactReading(line.text, req.verbatimText)) {
    session.greeting = "exact_timely";
    session.flowStep = "greeting verified · await identity";
    if (session.ivrReason) {
      session.nowCard = {
        title: "IVR routing (simulated)",
        body: `Provisional hint: ${session.ivrReason}. Not identity evidence. Greeting matched on the rail.`,
        sourceLabel: "System record · telephony · simulated",
      };
    }
    appendJsonl(session.sessionId, {
      kind: "greeting_verified",
      eventId: line.id,
      note: "paint timing recorded separately as event_to_client_paint",
    });
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
  session.nowCard = {
    title: "IVR routing (simulated)",
    body: `Provisional hint: ${ivrReason}. Not identity evidence. Greeting still due.`,
    sourceLabel: "System record · telephony · simulated",
  };
  appendJsonl(session.sessionId, { kind: "ivr_hint", ivrReason });
}

export function beginPause(session: SessionState, label: string) {
  if (session.paused) return;
  session.paused = true;
  session.pauseStartedAt = now();
  session.lastPauseLabel = label;
  appendJsonl(session.sessionId, {
    kind: "pause_started",
    label,
    tEvent: session.pauseStartedAt,
    excludedFromMachineTime: true,
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
  session.flowStep = "identity verified · refill workflow";
  session.currentNeed = "refill status";
  if (member && auth.decision.toLowerCase() === "valid") {
    session.nowCard = {
      title: "Member authorized (simulated)",
      body: `${member.name.given} ${member.name.family} · ${member.lineOfBusiness} · ${member.planId}. Protected fields were withheld until DEMO-AUTH001.`,
      sourceLabel: "System record · eligibility · simulated",
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
  appendJsonl(session.sessionId, { kind: "routeQuery", ...trace });
}

export function pushTriggerTrace(session: SessionState, trace: TriggerTrace) {
  session.diagnostics.triggers = [
    ...session.diagnostics.triggers,
    trace,
  ].slice(-20);
  appendJsonl(session.sessionId, { kind: "trigger_classification", ...trace });
}

export function showNow(
  session: SessionState,
  card: SessionState["nowCard"],
) {
  session.nowCard = card;
}

export { sessions };
