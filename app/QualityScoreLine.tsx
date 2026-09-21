"use client";

/**
 * After-call Quality Score line (display only).
 *
 * Every number is read back from this call's run log through
 * GET /api/session/quality. Nothing here is fixed text and nothing is keyed to a
 * scenario or a member: if the call had no required statements, the counts say
 * so. Clicking a number opens the raw log lines it was counted from.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { QualityBucketId, QualityScore } from "@/lib/qualityScore";

const PART_ORDER: QualityBucketId[] = [
  "required",
  "on_time",
  "late_corrected",
  "never_corrected",
  "could_not_verify",
];

function partWords(bucket: QualityBucketId, n: number): string {
  switch (bucket) {
    case "required":
      return `required statement${n === 1 ? "" : "s"}`;
    case "on_time":
      return "read on time";
    case "late_corrected":
      return "read late, corrected on the call";
    case "never_corrected":
      return "never corrected";
    case "could_not_verify":
      return "could not verify";
  }
}

function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function checkedWords(checkedBy: "code" | "model" | null): string {
  if (checkedBy === "model") return "the check used a model";
  if (checkedBy === "code") return "the check ran in code";
  return "check source not recorded";
}

function text(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" ? rec[key] : null;
}

function number(rec: Record<string, unknown>, key: string): number | null {
  const value = rec[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function callTime(rec: Record<string, unknown>): string {
  const ms = number(rec, "callMs");
  if (ms == null || ms <= 0) return "at the start of the call";
  return `${secs(ms)} into the call`;
}

/** Turn a required-wording log record into advocate-readable evidence. */
function evidenceWords(rec: Record<string, unknown>): string {
  const name = text(rec, "plainName") ?? "Required statement";
  const event = text(rec, "event");
  const status = text(rec, "to");
  const checkedBy = text(rec, "checkedBy") as "code" | "model" | null;
  const checked = checkedWords(checkedBy);

  if (event === "exact") {
    return `${name} was read exactly ${callTime(rec)}; ${checked}.`;
  }

  if (event === "nudge") {
    const latency = number(rec, "sinceEventMs");
    const template = text(rec, "template");
    const timing =
      latency == null
        ? "after the triggering words"
        : `${secs(latency)} after the triggering words`;
    return `${name} nudge appeared ${timing}${template ? ` with the message “${template}”` : ""}; ${checked}.`;
  }

  if (event === "status") {
    switch (status) {
      case "due_now":
        return `${name} became due ${callTime(rec)}.`;
      case "pending_later":
        return `${name} was queued for later in the call.`;
      case "not_applicable":
        return `${name} did not apply at this point in the call.`;
      case "exact_timely":
        return `${name} was verified as exact and on time ${callTime(rec)}; ${checked}.`;
      case "late_finding":
        return `${name} was identified as late ${callTime(rec)}; ${checked}.`;
      case "paraphrased":
        return `${name} differed from the required wording ${callTime(rec)}; ${checked}.`;
      case "unable_to_verify":
        return `${name} could not be verified ${callTime(rec)}; ${checked}.`;
      case "missed_not_recoverable":
        return `${name} was not corrected before the call ended.`;
    }
  }

  return `${name} evidence was recorded ${callTime(rec)}.`;
}

export function QualityScoreLine({
  sessionId,
  reviewStep,
}: {
  sessionId: string;
  reviewStep: number;
}) {
  const [score, setScore] = useState<QualityScore | null>(null);
  const [open, setOpen] = useState<QualityBucketId | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch(
        `/api/session/quality?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (!resp.ok) return;
      const json = (await resp.json()) as { score?: QualityScore };
      if (json.score) setScore(json.score);
    } catch {
      /* The score is display only; a failed read just leaves the line out. */
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    // Late trigger classifications can land just after the call ends.
    const t = setTimeout(() => void load(), 1200);
    return () => clearTimeout(t);
  }, [load, reviewStep]);

  // Moving between the after-call steps should open at the top of the card, not
  // part-way down whichever log lines were left open on the step before.
  useEffect(() => {
    setOpen(null);
    rootRef.current?.closest(".now-card-scroll")?.scrollTo({ top: 0 });
  }, [reviewStep]);

  if (!score) return null;

  const parts = PART_ORDER.filter(
    (bucket) => bucket === "never_corrected" || score.counts[bucket] > 0,
  );
  const openRecords = open ? score.evidence[open] : [];

  return (
    <div className="quality-score" ref={rootRef}>
      <p className="quality-score-line">
        <span className="quality-score-cap">Quality Score</span>
        {parts.map((bucket, i) => (
          <span key={bucket}>
            {i > 0 ? <span className="quality-sep"> · </span> : null}
            <button
              type="button"
              className={`quality-num${open === bucket ? " is-open" : ""}`}
              aria-expanded={open === bucket}
              onClick={() => setOpen(open === bucket ? null : bucket)}
              title="Open the log lines this number came from"
            >
              {score.counts[bucket]}
            </button>{" "}
            {partWords(bucket, score.counts[bucket])}
          </span>
        ))}
      </p>

      {score.misses.length > 0 ? (
        <ul className="quality-misses">
          {score.misses.map((miss) => (
            <li key={miss.requirementId}>
              <strong>{miss.plainName}</strong>
              {" — "}
              {miss.msToNudge == null
                ? "no nudge appeared"
                : `nudge ${secs(miss.msToNudge)} after the words`}
              {", "}
              {miss.msToExact == null
                ? "never read exactly"
                : `exact reading ${secs(miss.msToExact)} after the miss`}
              {" · "}
              {checkedWords(miss.checkedBy)}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="quality-evidence">
          <p className="quality-evidence-cap">
            {openRecords.length} log line{openRecords.length === 1 ? "" : "s"}{" "}
            behind “{partWords(open, score.counts[open])}” · {score.source}
          </p>
          {openRecords.length === 0 ? (
            <p className="quality-evidence-empty">
              No log lines — nothing was counted here.
            </p>
          ) : (
            <ol className="quality-evidence-lines">
              {openRecords.map((rec, i) => (
                <li key={i}>
                  {evidenceWords(rec)}
                  <code>{JSON.stringify(rec)}</code>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
