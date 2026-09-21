import { appendJsonl } from "@/lib/log";
import { isExactReading, isWordingAttempt } from "@/lib/exactness";
import { requiredWordingOnNow } from "@/lib/nowOccupancy";
import type { SessionState } from "@/lib/types";

export type LookupProgress = {
  sourceUtteranceId: string;
  question: string;
  startedAt: number;
  firstStepAt: number | null;
  firstFactAt: number | null;
  answeredAt: number | null;
  advocateWaitMs: number | null;
  /** Set when closed without a say (nothing_needed / timeout). Blocks stream dwell. */
  closedReason?: string;
};

export type HeldAdvocateLine = {
  id: string;
  text: string;
  stability: "final" | "corrected";
  queuedAt: number;
  deadlineAt: number;
  sourceUtteranceId?: string;
};

const HOLD_PHRASES = [
  "Let me look that up for you.",
  "Give me a moment to check that.",
  "I'll pull that up now.",
];

export const HONEST_MISS = "Could not answer this one — retry";

export function isInjectedHoldId(id: string) {
  return id.startsWith("hold-");
}

export function holdPhraseFor(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n += id.charCodeAt(i);
  return HOLD_PHRASES[n % HOLD_PHRASES.length];
}

export function progressCard(question: string) {
  return {
    title: question,
    headline: question,
    body: "",
    sourceLabel: "Copilot",
    waitingForFocus: false,
    liveSteps: ["Searching knowledge…"] as string[],
    earlyFacts: [] as { text: string; source: string }[],
  };
}

export function isProgressOnlyCard(session: SessionState) {
  const card = session.nowCard;
  if (session.nowCardOrigin !== "answer") return false;
  const body = (card.body ?? "").trim();
  if (!body) return true;
  const q = (session.rightNowLine || session.answerLoopAnchor?.question || "").trim();
  return Boolean(q) && body === q;
}

/** Synthesized say currently on Now — what the advocate reads out. */
export function sayOnNow(session: SessionState | null | undefined) {
  if (!session) return "";
  if (session.nowCardOrigin !== "answer") return "";
  const body = (session.nowCard.body ?? "").trim();
  if (!body) return "";
  if (isProgressOnlyCard(session)) return "";
  return body;
}

export function lookupHasAnswer(session: SessionState) {
  return Boolean(sayOnNow(session));
}

export function openLookup(session: SessionState): LookupProgress | undefined {
  return [...(session.lookupProgress ?? [])]
    .reverse()
    .find((p) => p.answeredAt == null);
}

export function lastUnansweredMemberQuestion(session: SessionState) {
  return [...session.transcript]
    .reverse()
    .find((t) => {
      if (t.speaker !== "member") return false;
      if (t.stability !== "final" && t.stability !== "corrected") return false;
      if (/,\s*(isn'?t|aren'?t|doesn'?t|don'?t|won'?t|right|ok|okay)\s+(it|that)?\s*\??$/i.test(t.text.trim())) {
        return false;
      }
      return (
        /\?/.test(t.text) ||
        /^(?:what|why|how|when|where|which|who|can|could|would|will|is|are|do|does|did|tell|check|explain|please|i (?:want|need|would like)|just)\b/i.test(
          t.text.trim(),
        )
      );
    });
}

export function startLookupProgress(
  session: SessionState,
  question: string,
  sourceUtteranceId?: string,
) {
  const id = sourceUtteranceId || `q-${session.answerLoopGeneration}`;
  const existing = (session.lookupProgress ?? []).find(
    (p) => p.sourceUtteranceId === id && p.answeredAt == null,
  );
  if (existing) return existing;
  const row: LookupProgress = {
    sourceUtteranceId: id,
    question,
    startedAt: Date.now(),
    firstStepAt: null,
    firstFactAt: null,
    answeredAt: null,
    advocateWaitMs: null,
  };
  session.lookupProgress = [...(session.lookupProgress ?? []), row].slice(-20);
  appendJsonl(session.sessionId, {
    kind: "lookup_started",
    sourceUtteranceId: id,
    question,
  });
  return row;
}

export function markLookupStep(session: SessionState, label: string) {
  const row = openLookup(session);
  if (!row) return;
  if (row.firstStepAt == null) {
    row.firstStepAt = Date.now();
    appendJsonl(session.sessionId, {
      kind: "lookup_first_step",
      sourceUtteranceId: row.sourceUtteranceId,
      label,
      ms: row.firstStepAt - row.startedAt,
    });
  }
}

export function markLookupFact(session: SessionState) {
  const row = openLookup(session);
  if (!row) return;
  if (row.firstFactAt == null) {
    row.firstFactAt = Date.now();
    appendJsonl(session.sessionId, {
      kind: "lookup_first_fact",
      sourceUtteranceId: row.sourceUtteranceId,
      ms: row.firstFactAt - row.startedAt,
    });
  }
}

export function markLookupAnswered(
  session: SessionState,
  sourceUtteranceId?: string,
) {
  const row = sourceUtteranceId
    ? (session.lookupProgress ?? []).find(
        (p) => p.sourceUtteranceId === sourceUtteranceId && p.answeredAt == null,
      )
    : openLookup(session);
  if (!row || row.answeredAt != null) return;
  row.answeredAt = Date.now();
  appendJsonl(session.sessionId, {
    kind: "lookup_answered",
    sourceUtteranceId: row.sourceUtteranceId,
    ms: row.answeredAt - row.startedAt,
  });
}

export function expireStaleLookups(session: SessionState) {
  if (
    session.answerLoopAnchor &&
    session.nowCardOrigin === "answer" &&
    !Boolean((session.nowCard.body ?? "").trim())
  ) {
    return;
  }
  const now = Date.now();
  for (const row of session.lookupProgress ?? []) {
    if (row.answeredAt == null && now >= row.startedAt + 8000) {
      closeLookupWithoutAnswer(session, "timeout_8s", row.sourceUtteranceId);
    }
  }
}

/** Caller stays on hold until the synthesized say is on Now. */
export function memberOnHold(session: SessionState | null | undefined) {
  if (!session) return false;
  if (sayOnNow(session)) return false;
  const looking =
    session.nowCardOrigin === "answer" &&
    Boolean((session.nowCard.title ?? "").trim()) &&
    !Boolean((session.nowCard.body ?? "").trim());
  const open = openLookup(session);
  return Boolean(open || looking);
}

export function closeLookupWithoutAnswer(
  session: SessionState,
  reason: string,
  sourceUtteranceId?: string,
) {
  const row = sourceUtteranceId
    ? (session.lookupProgress ?? []).find(
        (p) => p.sourceUtteranceId === sourceUtteranceId && p.answeredAt == null,
      )
    : openLookup(session);
  if (!row || row.answeredAt != null) return;
  row.answeredAt = Date.now();
  row.closedReason = reason;
  appendJsonl(session.sessionId, {
    kind: "lookup_closed",
    sourceUtteranceId: row.sourceUtteranceId,
    reason,
    ms: row.answeredAt - row.startedAt,
  });
}

function requiredAdvocateSpeech(session: SessionState, text: string) {
  if (session.enrollment.readback && isWordingAttempt(text, session.enrollment.readback)) {
    return true;
  }
  return session.disclosures.some(
    (d) => d.verbatimText && isWordingAttempt(text, d.verbatimText),
  );
}

export function shouldDeferAdvocateLine(
  session: SessionState,
  ev: { id: string; speaker?: string; stability?: string; text?: string },
) {
  expireStaleLookups(session);
  if (ev.speaker !== "advocate") return false;
  if (ev.stability !== "final" && ev.stability !== "corrected") return false;
  if (isInjectedHoldId(ev.id)) return false;
  if (requiredWordingOnNow(session)) return false;
  if (session.pricing !== "not_applicable") return false;
  if (
    session.consent.comparison === "absolute_yes" ||
    session.consent.comparison === "hedge"
  ) {
    return false;
  }
  if (requiredAdvocateSpeech(session, ev.text ?? "")) return false;
  if (isExactReading(ev.text ?? "", session.enrollment.readback || "\0")) return false;
  const open = openLookup(session);
  if (open) {
    if (lookupHasAnswer(session)) return false;
    if (Date.now() >= open.startedAt + 8000) return false;
    if (
      (session.heldAdvocateLines ?? []).some(
        (h) => h.sourceUtteranceId === open.sourceUtteranceId,
      )
    ) {
      return false;
    }
    return true;
  }
  const lastQ = lastUnansweredMemberQuestion(session);
  if (!lastQ) return false;
  const filed = session.needs.find(
    (n) =>
      (n.sourceUtteranceId === lastQ.id || n.queryText === lastQ.text) &&
      Boolean(n.answer?.body),
  );
  if (filed) return false;
  if (Date.now() >= lastQ.receivedAt + 8000) return false;
  if ((session.heldAdvocateLines ?? []).length) return false;
  return true;
}

export function queueAdvocateLine(
  session: SessionState,
  ev: { id: string; text: string; stability: "final" | "corrected" },
) {
  const open = openLookup(session);
  const lastQ = lastUnansweredMemberQuestion(session);
  const t0 = open?.startedAt ?? lastQ?.receivedAt ?? Date.now();
  const deadlineAt = t0 + 8000;
  session.heldAdvocateLines = [
    ...(session.heldAdvocateLines ?? []),
    {
      id: ev.id,
      text: ev.text,
      stability: ev.stability,
      queuedAt: Date.now(),
      deadlineAt,
      sourceUtteranceId: open?.sourceUtteranceId ?? lastQ?.id,
    },
  ];
  appendJsonl(session.sessionId, {
    kind: "advocate_line_held",
    eventId: ev.id,
    sourceUtteranceId: open?.sourceUtteranceId ?? lastQ?.id ?? null,
    deadlineAt,
  });
}

export function takeReadyAdvocateLines(session: SessionState): HeldAdvocateLine[] {
  if (!(session.heldAdvocateLines ?? []).length) return [];
  const ready: HeldAdvocateLine[] = [];
  const keep: HeldAdvocateLine[] = [];
  const answered = lookupHasAnswer(session);
  const open = openLookup(session);
  const now = Date.now();
  for (const line of session.heldAdvocateLines) {
    const timeout = now >= line.deadlineAt;
    const settled = answered || !open;
    if (settled || timeout) {
      const waitMs = now - line.queuedAt;
      const row = (session.lookupProgress ?? []).find(
        (p) => p.sourceUtteranceId === line.sourceUtteranceId,
      );
      if (row && row.advocateWaitMs == null) row.advocateWaitMs = waitMs;
      if (timeout && !answered) {
        line.text =
          session.nowCard.body && !isProgressOnlyCard(session)
            ? session.nowCard.body
            : HONEST_MISS;
      }
      appendJsonl(session.sessionId, {
        kind: "advocate_line_released",
        eventId: line.id,
        waitMs,
        reason: answered ? "answer" : timeout ? "timeout" : "settled",
        machineTime: true,
      });
      ready.push(line);
    } else keep.push(line);
  }
  session.heldAdvocateLines = keep;
  return ready;
}

export function lookupReportRows(session: SessionState) {
  return (session.lookupProgress ?? []).map((p) => {
    const firstStepMs = p.firstStepAt != null ? p.firstStepAt - p.startedAt : null;
    const firstFactMs = p.firstFactAt != null ? p.firstFactAt - p.startedAt : null;
    const fullAnswerMs = p.answeredAt != null ? p.answeredAt - p.startedAt : null;
    return {
      question: p.question,
      firstStepMs,
      firstFactMs,
      fullAnswerMs,
      advocateWaitMs: p.advocateWaitMs,
      miss1s: firstStepMs != null ? firstStepMs > 1000 : true,
      miss2s: firstFactMs != null ? firstFactMs > 2000 : true,
      miss5s: fullAnswerMs != null ? fullAnswerMs > 5000 : true,
      miss8s: fullAnswerMs != null ? fullAnswerMs > 8000 : true,
    };
  });
}
