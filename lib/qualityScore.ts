/**
 * After-call Quality Score (display only).
 *
 * Rebuilt from this call's §22.3 run log on every read. Nothing here reads live
 * session state and nothing is keyed to a scenario, a member, or a beat, so the
 * numbers move whenever the call does. It never writes and never decides.
 */
import { REQUIRED_WORDING_KIND } from "@/lib/obligationLog";
import type { LogRecord } from "@/lib/log";
import { readJsonl } from "@/lib/log";

export type QualityBucketId =
  | "required"
  | "on_time"
  | "late_corrected"
  | "never_corrected"
  | "could_not_verify";

export type QualityOutcome = Exclude<QualityBucketId, "required">;

/** Statuses that mean the obligation went wrong, not merely that it came due. */
const MISS_STATUSES = new Set([
  "late_finding",
  "paraphrased",
  "unable_to_verify",
  "missed_not_recoverable",
]);

export type QualityRequirement = {
  requirementId: string;
  plainName: string;
  /** A statement counts only if its rule applied on this call. */
  applied: boolean;
  finalStatus: string;
  outcome: QualityOutcome | null;
  /** When the obligation first went wrong, in pause-excluded call time. */
  missAtMs: number | null;
  /** Advocate's words to nudge on screen. Machine response time. */
  msToNudge: number | null;
  /** The miss to the exact reading, in pause-excluded call time. */
  msToExact: number | null;
  checkedBy: "code" | "model" | null;
  records: LogRecord[];
};

export type QualityScore = {
  sessionId: string;
  counts: Record<QualityBucketId, number>;
  requirements: QualityRequirement[];
  /** Requirements that did not land on time, in the order they came due. */
  misses: QualityRequirement[];
  evidence: Record<QualityBucketId, LogRecord[]>;
  logRecords: number;
  source: string;
};

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function outcomeOf(
  finalStatus: string,
  trail: LogRecord[],
  hasExact: boolean,
): QualityOutcome {
  if (hasExact) {
    return finalStatus === "exact_timely" ? "on_time" : "late_corrected";
  }
  if (finalStatus === "exact_timely") return "on_time";
  if (finalStatus === "unable_to_verify") return "could_not_verify";
  // A call can end while an uncertain reading is still unresolved. Settling it
  // as not recoverable is the compliance outcome; for the advocate the honest
  // words are still "could not verify".
  const wasUnverifiable = trail.some(
    (r) => r.event === "status" && r.to === "unable_to_verify",
  );
  if (wasUnverifiable) return "could_not_verify";
  return "never_corrected";
}

export function scoreQualityRecords(
  sessionId: string,
  records: LogRecord[],
): QualityScore {
  const wording = records.filter((r) => r.kind === REQUIRED_WORDING_KIND);

  const byRequirement = new Map<string, LogRecord[]>();
  const order: string[] = [];
  for (const rec of wording) {
    const id = str(rec.requirementId);
    if (!id) continue;
    if (!byRequirement.has(id)) {
      byRequirement.set(id, []);
      order.push(id);
    }
    byRequirement.get(id)!.push(rec);
  }

  const requirements: QualityRequirement[] = order.map((requirementId) => {
    const trail = byRequirement.get(requirementId)!;
    const statuses = trail.filter((r) => r.event === "status");
    const finalStatus =
      str(statuses[statuses.length - 1]?.to) ?? "not_applicable";
    // `pending_later` means the rule may yet apply, not that it did. Call end
    // resolves it either way; this only matters if the log is read mid-call.
    const applied =
      finalStatus !== "not_applicable" && finalStatus !== "pending_later";

    const exactRec = trail.find((r) => r.event === "exact") ?? null;
    const missRec =
      statuses.find((r) => MISS_STATUSES.has(String(r.to))) ??
      statuses.find((r) => r.to === "due_now") ??
      null;
    const missAtMs = missRec ? num(missRec.callMs) : null;

    const nudgeRecs = trail.filter((r) => r.event === "nudge");
    const nudgeRec =
      (missAtMs != null
        ? nudgeRecs.find((r) => (num(r.callMs) ?? 0) >= missAtMs)
        : null) ??
      nudgeRecs[0] ??
      null;

    // The nudge is written in the same pass as the miss it answers, so the gap
    // between their call-clock stamps would always be zero. Measure it from the
    // advocate's words instead — that is the latency the advocate feels.
    const base = missAtMs ?? 0;
    const msToNudge = nudgeRec ? num(nudgeRec.sinceEventMs) : null;
    const exactAt = exactRec ? num(exactRec.callMs) : null;

    const outcome = applied
      ? outcomeOf(finalStatus, trail, Boolean(exactRec))
      : null;

    return {
      requirementId,
      plainName:
        str(trail.find((r) => str(r.plainName))?.plainName) ?? requirementId,
      applied,
      finalStatus,
      outcome,
      missAtMs,
      msToNudge,
      msToExact: exactAt == null ? null : Math.max(0, exactAt - base),
      checkedBy:
        (str(missRec?.checkedBy) as "code" | "model" | null) ??
        (str(nudgeRec?.checkedBy) as "code" | "model" | null) ??
        (str(exactRec?.checkedBy) as "code" | "model" | null),
      records: trail,
    };
  });

  const appliedReqs = requirements.filter((r) => r.applied);
  const inBucket = (bucket: QualityOutcome) =>
    appliedReqs.filter((r) => r.outcome === bucket);

  const evidence: Record<QualityBucketId, LogRecord[]> = {
    required: appliedReqs.flatMap((r) => r.records),
    on_time: inBucket("on_time").flatMap((r) => r.records),
    late_corrected: inBucket("late_corrected").flatMap((r) => r.records),
    never_corrected: inBucket("never_corrected").flatMap((r) => r.records),
    could_not_verify: inBucket("could_not_verify").flatMap((r) => r.records),
  };

  return {
    sessionId,
    counts: {
      required: appliedReqs.length,
      on_time: inBucket("on_time").length,
      late_corrected: inBucket("late_corrected").length,
      never_corrected: inBucket("never_corrected").length,
      could_not_verify: inBucket("could_not_verify").length,
    },
    requirements,
    misses: appliedReqs
      .filter((r) => r.outcome && r.outcome !== "on_time")
      .sort((a, b) => (a.missAtMs ?? 0) - (b.missAtMs ?? 0)),
    evidence,
    logRecords: records.length,
    source: `runs/${sessionId}.jsonl`,
  };
}

export function scoreQualityFromLog(sessionId: string): QualityScore {
  return scoreQualityRecords(sessionId, readJsonl(sessionId));
}
