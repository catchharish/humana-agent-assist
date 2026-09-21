/**
 * Contract §22.3 run-log records for the required-wording obligations.
 *
 * Purely additive observability: this module never changes obligation state, it
 * only writes down transitions that already happened so the after-call Quality
 * Score can be rebuilt from the run log instead of from live session state.
 *
 * Call `logObligationTransitions` after any write path that can move an
 * obligation. It diffs against the last record it wrote for this session, so
 * calling it redundantly is harmless and calling it twice logs nothing twice.
 */
import { NUDGE_CLOSING, NUDGE_PRICING } from "@/lib/copy";
import { appendJsonl } from "@/lib/log";
import type { ObligationStatus, SessionState } from "@/lib/types";

export const REQUIRED_WORDING_KIND = "required_wording";

export type ObligationSlot = "greeting" | "pricing" | "closing";
export type CheckSource = "code" | "model";

export const SLOT_REQUIREMENT_ID: Record<ObligationSlot, string> = {
  greeting: "DEMO-GREETING-v1",
  pricing: "DEMO-PRICING-v1",
  closing: "DEMO-CLOSING-v2",
};

const SLOTS: ObligationSlot[] = ["greeting", "pricing", "closing"];

type Snapshot = {
  status: Record<ObligationSlot, ObligationStatus>;
  exact: Record<ObligationSlot, boolean>;
  nudgeKey: string | null;
};

/**
 * Same globalThis pin as the session store. Dev re-evaluates server modules, and
 * a fresh Map would re-log every obligation as if it had just changed.
 */
const g = globalThis as unknown as {
  __haaObligationSnapshots?: Map<string, Snapshot>;
  __haaObligationCheckSources?: Map<
    string,
    Partial<Record<ObligationSlot, CheckSource>>
  >;
};
g.__haaObligationSnapshots ??= new Map<string, Snapshot>();
g.__haaObligationCheckSources ??= new Map<
  string,
  Partial<Record<ObligationSlot, CheckSource>>
>();
const lastSnapshot = g.__haaObligationSnapshots;
const lastCheckSource = g.__haaObligationCheckSources;

/**
 * Record how the most recent check for a slot ran, so the transition it causes
 * is logged as code (stage 1) or model (stage 2 luna). Call before mutating.
 */
export function noteCheckSource(
  session: SessionState,
  slot: ObligationSlot,
  source: CheckSource,
) {
  const current = lastCheckSource.get(session.sessionId) ?? {};
  current[slot] = source;
  lastCheckSource.set(session.sessionId, current);
}

export function forgetObligationLog(sessionId: string) {
  lastSnapshot.delete(sessionId);
  lastCheckSource.delete(sessionId);
}

/** Pause intervals are presenter gates, never machine response time (§22.1). */
function callMs(session: SessionState): number {
  const live =
    session.paused && session.pauseStartedAt
      ? Date.now() - session.pauseStartedAt
      : 0;
  return Math.max(
    0,
    Date.now() - session.startedAt - session.totalPauseMs - live,
  );
}

function exactDelivered(session: SessionState, slot: ObligationSlot): boolean {
  if (slot === "greeting") {
    return (
      session.greetingLocked &&
      (session.greeting === "exact_timely" ||
        session.greeting === "late_finding")
    );
  }
  if (slot === "pricing") return session.pricingExactDelivered;
  return session.closingLocked && session.closing === "exact_timely";
}

/** Which requirement a nudge belongs to. Registry text first, template second. */
function nudgeSlot(session: SessionState): ObligationSlot | null {
  const nudge = session.nudge;
  if (!nudge) return null;
  if (nudge.requiredText) {
    for (const slot of SLOTS) {
      const req = session.disclosures.find(
        (d) => d.requirementId === SLOT_REQUIREMENT_ID[slot],
      );
      if (req && req.verbatimText === nudge.requiredText) return slot;
    }
  }
  if (nudge.template === NUDGE_PRICING) return "pricing";
  if (nudge.template === NUDGE_CLOSING) return "closing";
  return null;
}

function snapshotOf(session: SessionState): Snapshot {
  const slot = nudgeSlot(session);
  return {
    status: {
      greeting: session.greeting,
      pricing: session.pricing,
      closing: session.closing,
    },
    exact: {
      greeting: exactDelivered(session, "greeting"),
      pricing: exactDelivered(session, "pricing"),
      closing: exactDelivered(session, "closing"),
    },
    nudgeKey: session.nudge
      ? `${slot ?? "unassigned"}::${session.nudge.template}`
      : null,
  };
}

function plainNameOf(session: SessionState, slot: ObligationSlot): string {
  const req = session.disclosures.find(
    (d) => d.requirementId === SLOT_REQUIREMENT_ID[slot],
  );
  return req?.plainName ?? SLOT_REQUIREMENT_ID[slot];
}

/**
 * Diff the obligations against the last logged snapshot and append one
 * `required_wording` record per real change. Safe to call anywhere.
 */
export function logObligationTransitions(
  session: SessionState,
  ctx: { eventId?: string | null } = {},
) {
  const next = snapshotOf(session);
  const prev = lastSnapshot.get(session.sessionId);
  const at = callMs(session);
  const sources = lastCheckSource.get(session.sessionId) ?? {};
  const eventId = ctx.eventId ?? null;
  // Machine response time for this transition: from the words landing to now.
  // Status and nudge are written in the same pass, so a gap between them would
  // measure nothing; the utterance is the only honest start of the clock.
  const saidAt = eventId
    ? (session.transcript.find((t) => t.id === eventId)?.receivedAt ?? null)
    : null;
  const sinceEventMs = saidAt == null ? null : Math.max(0, Date.now() - saidAt);

  for (const slot of SLOTS) {
    const requirementId = SLOT_REQUIREMENT_ID[slot];
    const plainName = plainNameOf(session, slot);
    const checkedBy: CheckSource = sources[slot] ?? "code";

    if (!prev || prev.status[slot] !== next.status[slot]) {
      appendJsonl(session.sessionId, {
        kind: REQUIRED_WORDING_KIND,
        event: "status",
        requirementId,
        plainName,
        slot,
        from: prev ? prev.status[slot] : null,
        to: next.status[slot],
        checkedBy,
        callMs: at,
        sinceEventMs,
        eventId,
      });
    }

    if ((!prev || !prev.exact[slot]) && next.exact[slot]) {
      appendJsonl(session.sessionId, {
        kind: REQUIRED_WORDING_KIND,
        event: "exact",
        requirementId,
        plainName,
        slot,
        status: next.status[slot],
        checkedBy,
        callMs: at,
        sinceEventMs,
        eventId,
      });
    }
  }

  if (next.nudgeKey && next.nudgeKey !== prev?.nudgeKey) {
    const slot = nudgeSlot(session);
    appendJsonl(session.sessionId, {
      kind: REQUIRED_WORDING_KIND,
      event: "nudge",
      requirementId: slot ? SLOT_REQUIREMENT_ID[slot] : null,
      plainName: slot ? plainNameOf(session, slot) : null,
      slot,
      template: session.nudge?.template ?? null,
      checkedBy: (slot && sources[slot]) || "code",
      callMs: at,
      sinceEventMs,
      eventId,
    });
  }

  lastSnapshot.set(session.sessionId, next);
}
