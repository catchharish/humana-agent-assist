import { invalidateSessionTokens } from "@/lib/enrollmentToken";
import { interpretUtterance, type Interpretation } from "@/lib/interpret";
import { terraComplete, parseJsonObject } from "@/lib/openai";
import { routeQuery, type RouterResult } from "@/lib/queryRouter";
import { publishSession } from "@/lib/sse";
import { interpretUtterance, type Interpretation } from "@/lib/interpret";
import { terraComplete, parseJsonObject } from "@/lib/openai";
import { routeQuery, type RouterResult } from "@/lib/queryRouter";
import { publishSession } from "@/lib/sse";
import { appendJsonl } from "@/lib/log";
import {
  CLARIFY_INTEREST,
  NUDGE_CLOSING,
  NUDGE_PARAPHRASE,
  NUDGE_PRICING,
  OBJECTION_BODY,
  enrollmentReadback,
  offerBody,
  transferOffer,
} from "@/lib/copy";
import { isExactReading, wordDiff } from "@/lib/exactness";
import {
  getNeed,
  pushRouterTrace,
  pushTriggerTrace,
  setFocus,
  showNow,
  upsertNeed,
} from "@/lib/session";
import { classifyPricingTrigger } from "@/lib/triggers";
import type { SessionState } from "@/lib/types";

const historicalJobs = new Set<string>();

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
  return q?.pharmacyName || "the mail pharmacy";
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

function sessionEnrollmentReadback(session: SessionState) {
  const delivery = session.enrollment.medications;
  const quoted = [
    ...new Set(session.quotes.map((q) => q.drugName).filter(Boolean)),
  ];
  const retail = quoted.filter(
    (d) => !delivery.some((x) => x.toLowerCase() === d.toLowerCase()),
  );
  return enrollmentReadback({
    mailPharmacy: mailPharmacyName(session),
    deliveryMedications: delivery,
    retailMedications: retail,
    pickupPharmacy: pickupPharmacyName(session),
  });
}

function fingerprint(parts: string[]) {
  return parts.sort().join("|");
}

function historicalFingerprint(routed: RouterResult) {
  return fingerprint([
    ...routed.evidence.claims.map(
      (c) => `${c.claimId}:${c.dateOfService ?? ""}:${c.memberPaidAmount?.value ?? ""}`,
    ),
    ...routed.evidence.classifications.map(
      (c) => `${c.classificationId}:${c.asOfDate ?? ""}:${c.networkTier ?? ""}`,
    ),
    `${routed.evidence.selectedPolicy?.id ?? "no-policy"}:${routed.evidence.selectedPolicy?.effectiveDate ?? ""}`,
    routed.evidence.causeSupported ? "cause" : "no-cause",
  ]);
}

async function draftHistorical(session: SessionState, routed: RouterResult) {
  const terra = await terraComplete(
    `Write the advocate-facing Now-card body for a historical completed-charge question.
Return JSON only: {"title":string,"body":string}

Rules:
- Use only the Evidence JSON. Do not add drugs, pharmacies, amounts, dates, or categories that are not in Evidence.
- If causeSupported is true: explain using the retrieved claims, classifications, and selected policy. Do not claim the plan changed, invent why the member used a pharmacy, or claim that all retail is more expensive than mail.
- If causeSupported is false: state that completed charges are or are not established per Evidence, and that cause is not established. Name missing support ids from Evidence.missing. Do not invent a pharmacy-category cause.
- No optional enrollment offer. These are completed charges, not estimates.
- Do not mention beat numbers or scenario ids.

Evidence (authoritative):
${JSON.stringify({
  chargesEstablished: routed.evidence.chargesEstablished,
  causeSupported: routed.evidence.causeSupported,
  missing: routed.evidence.missing,
  claims: routed.evidence.claims,
  classifications: routed.evidence.classifications,
  selectedPolicy: routed.evidence.selectedPolicy,
  rejected: routed.rejected,
})}`,
    500,
  );
  const parsed = parseJsonObject<{ title?: string; body?: string }>(terra.text);
  const title =
    parsed?.title ??
    (routed.evidence.causeSupported
      ? "Historical charges"
      : "Historical charges — cause not established");
  const body =
    parsed?.body ??
    (terra.ok
      ? terra.text
      : "Interpretation/answer model unavailable. Charges were retrieved; no generated explanation.");
  const sourceLabel = routed.evidence.causeSupported
    ? "System record · claims · simulated; Governed guidance · scripting · simulated"
    : "System record · claims · simulated";
  const fp = historicalFingerprint(routed);
  upsertNeed(session, "historical_price", {
    fingerprint: fp,
    answer: {
      title,
      body,
      sourceLabel,
      causeSupported: routed.evidence.causeSupported,
      chargesEstablished: routed.evidence.chargesEstablished,
    },
  });
  return { title, body, sourceLabel, fp, routed };
}

function presentHistorical(
  session: SessionState,
  routed: RouterResult,
  drafted: { title: string; body: string; sourceLabel: string },
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
    });
    maybeOfferComparison(session);
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
  const routed = await routeQuery({
    origin,
    need: "historical_price",
    memberId,
    planId,
    overlay: session.overlay,
    queryText,
    injectedDelayMs: opts.injectedDelayMs,
  });
  pushRouterTrace(session, {
    routesUsed: routed.routesUsed,
    latencyMs: routed.latencyMs,
    retrieved: routed.retrieved,
    rejected: routed.rejected,
    ranked: routed.ranked,
    injectedDelayMs: routed.injectedDelayMs,
    recheck: opts.recheck,
  });
  const fp = historicalFingerprint(routed);
  const prev = getNeed(session, "historical_price");
  if (opts.recheck && prev?.fingerprint === fp && prev.answer) {
    session.diagnostics.rechecks.push({
      at: new Date().toISOString(),
      fingerprint: fp,
      changed: false,
    });
    presentHistorical(session, routed, {
      title: prev.answer.title,
      body: prev.answer.body,
      sourceLabel: prev.answer.sourceLabel,
    });
    publishSession(session);
    return;
  }
  const drafted = await draftHistorical(session, routed);
  if (opts.recheck) {
    session.diagnostics.rechecks.push({
      at: new Date().toISOString(),
      fingerprint: drafted.fp,
      changed: Boolean(prev?.fingerprint && prev.fingerprint !== drafted.fp),
    });
  }
  presentHistorical(session, routed, drafted);
  publishSession(session);
}

export async function promoteHistorical(
  session: SessionState,
  origin: string,
) {
  const hist = getNeed(session, "historical_price");
  const queryText = hist?.queryText;
  if (!queryText) {
    showNow(session, {
      title: "Need clarification",
      body: "A deferred historical-price need has no originating query in conversation state. Withholding rather than guessing.",
      sourceLabel: "Governed guidance · scripting · simulated",
    });
    return;
  }
  upsertNeed(session, "historical_price", {
    status: "active",
    guidance: "preparing",
  });
  setFocus(
    session,
    "historical_price",
    "recheck dependencies → explain or preserve gap",
  );
  await runHistorical(session, origin, queryText, {
    injectedDelayMs: 0,
    recheck: true,
  });
}

function maybeOfferComparison(session: SessionState) {
  if (session.optionalWorkSuppressed) return;
  const refill = getNeed(session, "refill_status");
  const hist = getNeed(session, "historical_price");
  if (!refill) return;
  if (refill.status !== "resolved" && refill.guidance !== "ready") return;
  if (hist?.status !== "resolved") return;
  if (session.recommendation) return;
  session.recommendation = {
    kind: "optional_comparison",
    title: "Optional comparison",
    body: offerBody({ mailPharmacy: mailPharmacyName(session) }),
    sourceLabel: "Governed guidance · scripting · simulated",
    status: "pending",
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
  if (session.pricingExactDelivered) return;
  if (session.pricing === "exact_timely" || session.pricing === "not_applicable") {
    return;
  }
  const req = pricingRequirement(session);
  if (!req) return;
  const exact = isExactReading(line.text, req.verbatimText);
  if (exact) {
    markExactPricingDelivery(session, line);
    if (session.estimateSpokenWithoutReading || session.pricing === "late_finding") {
      session.pricing = "late_finding";
      session.pricingNote = "Delivered correctly, but late.";
      if (session.quotes.length > 0) {
        showNow(session, {
          title: "Prospective comparison",
          body: `${quoteNowBody(session)} No universal cheapest or guaranteed savings.`,
          sourceLabel: "System record · pharmacy · simulated",
        });
      }
    } else {
      session.pricing = "exact_timely";
      session.pricingNote = null;
    }
    return;
  }
  if (session.pricing === "due_now" || session.pricing === "late_finding") {
    const diff = wordDiff(line.text, req.verbatimText);
    if (diff.missingFromHeard.length > 0 || diff.extraInHeard.length > 0) {
      session.pricing = session.estimateSpokenWithoutReading
        ? "late_finding"
        : "paraphrased";
      session.nudge = {
        template: NUDGE_PARAPHRASE,
        heard: line.text,
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
      `${q.drugName} at ${q.pharmacyName}: $${q.estimatedMemberCost.value} (90-day estimate)`,
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

export async function loadQuotes(
  session: SessionState,
  origin: string,
  opts?: { pharmacyId?: string; delayMs?: number; generation?: number },
) {
  const memberId = session.member?.memberId ?? "";
  const planId = session.member?.planId ?? "";
  const pharmacyId = opts?.pharmacyId ?? session.quoteFocus?.pharmacyId;
  const generation = opts?.generation ?? session.quoteGeneration;
  const routed = await routeQuery({
    origin,
    need: "prospective_comparison",
    memberId,
    planId,
    overlay: session.overlay,
    quotePharmacyId: pharmacyId,
    injectedDelayMs: 0,
  });
  pushRouterTrace(session, {
    routesUsed: routed.routesUsed,
    latencyMs: routed.latencyMs,
    retrieved: routed.retrieved,
    rejected: routed.rejected,
    ranked: routed.ranked,
    injectedDelayMs: 0,
  });
  const mapped = mapQuotes(session, routed.evidence.quotes);
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
  upsertNeed(session, "prospective_comparison", {
    status: "active",
    guidance: "ready",
    flowStep: "educate → confirm interest → compare estimates",
  });
  setFocus(
    session,
    "prospective_comparison",
    "confirm interest → compare estimates",
  );
  if (session.pricing === "not_applicable") {
    session.pricing = "due_now";
  }
  const req = pricingRequirement(session);
  const due = session.pricing === "due_now" || session.pricing === "late_finding";
  showNow(session, {
    title: due ? "Pricing statement due now" : "Prospective comparison",
    body: due ? (req?.verbatimText ?? "") : quoteNowBody(session),
    sourceLabel: due
      ? "Governed guidance · scripting · simulated"
      : "System record · pharmacy · simulated",
  });
}

function requestQuotes(
  session: SessionState,
  origin: string,
  pharmacyId: string | undefined,
  drug: string | undefined,
) {
  session.quoteGeneration += 1;
  const generation = session.quoteGeneration;
  if (pharmacyId) {
    session.quoteFocus = {
      drug: drug || session.quoteFocus?.drug || "requested",
      pharmacyId,
    };
  }
  return loadQuotes(session, origin, { pharmacyId, generation });
}

export async function loadFast90(session: SessionState, origin: string) {
  const pre = session.prefetch?.fast90;
  let art = pre ?? null;
  if (!art) {
    const routed = await routeQuery({
      origin,
      need: "service_education",
      memberId: session.member?.memberId ?? "",
      planId: session.member?.planId ?? "",
      overlay: session.overlay,
    });
    pushRouterTrace(session, {
      routesUsed: routed.routesUsed,
      latencyMs: routed.latencyMs,
      retrieved: routed.retrieved,
      rejected: routed.rejected,
      ranked: routed.ranked,
      injectedDelayMs: 0,
    });
    art = routed.evidence.fast90;
  } else {
    pushRouterTrace(session, {
      routesUsed: ["governed_derived"],
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
  setFocus(session, "service_education", "educate → confirm interest");
  showNow(session, {
    title: "90-day option",
    body: `${art?.body ?? ""}\n\nEnrollment is not an order, not automatic refills, and does not change today's pickup. No delivery deadline is established.`,
    sourceLabel: `Derived from source/version · scripting · simulated (${art?.articleId} ← ${art?.lineageSourceId})`,
  });
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
}

export function applyHumanDismiss(session: SessionState) {
  if (!session.recommendation) return;
  session.recommendation.status = "dismissed";
}

export function applyHumanObjection(session: SessionState) {
  session.recommendation = {
    kind: "objection_retail",
    title: "Governed hesitation response",
    body: OBJECTION_BODY,
    sourceLabel: "Governed guidance · scripting · simulated",
    status: "used",
  };
  showNow(session, {
    title: "Governed hesitation response",
    body: OBJECTION_BODY,
    sourceLabel: "Governed guidance · scripting · simulated",
  });
}

export function applyHumanEditEnrollmentScope(
  session: SessionState,
  medications: string[],
) {
  invalidateSessionTokens(session.sessionId);
  session.enrollment.medications = medications;
  session.enrollment.confirmed = false;
  session.consent.enrollment = "none";
  session.enrollment.readback = sessionEnrollmentReadback(session);
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
  if (session.recommendation?.kind === "warm_transfer") return;
  if (session.recommendation?.kind === "optional_comparison") return;
  if (session.disposition.recommended) return;
  if (session.enrollment.submitted) return;
  if (getNeed(session, "historical_price")) return;
  if (getNeed(session, "coverage_status")) return;
  if (getNeed(session, "prospective_comparison")) return;
  const election = getNeed(session, "service_election");
  if (election && !session.enrollment.withdrawn) return;
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

function looksLikeClosing(text: string) {
  return /decision|membership|plan membership/i.test(text);
}

async function draftWrapStable(session: SessionState) {
  const terra = await terraComplete(
    `Write a concise wrap note of completed servicing so far. JSON only: {"wrap":string}
Rules: use only Evidence. Do not state a transfer connection, specialist connected, or final disposition. Those have not returned. Do not invent pickup, approval, or coverage determination.
Evidence:
${JSON.stringify({
  refill: getNeed(session, "refill_status")?.answer ?? session.prefetch?.refill,
  historical: getNeed(session, "historical_price")?.answer ?? null,
  education: getNeed(session, "service_education")?.answer ?? null,
  enrollment: session.enrollment,
  coverage: session.coverage,
  pricing: session.pricing,
  closing: session.closing,
  optionalWorkSuppressed: session.optionalWorkSuppressed,
})}`,
    500,
  );
  const parsed = parseJsonObject<{ wrap?: string }>(terra.text);
  session.wrapStable =
    parsed?.wrap ??
    (terra.ok ? terra.text : "Wrap draft unavailable. Use a manual note.");
  if (!session.transfer.connectionStatus) {
    session.wrapDraft = session.wrapStable;
  }
  publishSession(session);
}

function fillWrapOutcome(session: SessionState) {
  const caseId = session.coverage?.caseId;
  const status = session.coverage?.status;
  const outcome = session.transfer.connectionStatus
    ? `Connection result: ${session.transfer.transferId ?? "unassigned"} — ${session.transfer.connectionStatus}. ${caseId ?? "The coverage case"} remains ${status ?? "pending"}. Connection is not a coverage determination.`
    : "No connection result has returned; do not state a transfer outcome.";
  session.wrapDraft = [session.wrapStable, outcome].filter(Boolean).join("\n\n");
  session.outcomeReady = true;
}

function assessClosing(
  session: SessionState,
  line: { text: string; stability: string },
) {
  if (line.stability === "partial") return;
  if (session.closing === "not_applicable") return;
  const req = closingRequirement(session);
  if (!req) return;
  if (line.stability === "uncertain" && looksLikeClosing(line.text)) {
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
    });
    return;
  }
  if (
    (line.stability === "final" || line.stability === "corrected") &&
    isExactReading(line.text, req.verbatimText)
  ) {
    session.nudge =
      session.nudge?.template === NUDGE_CLOSING ? null : session.nudge;
    session.closing = "exact_timely";
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
  }
}

export async function loadCoverage(session: SessionState, origin: string) {
  const routed = await routeQuery({
    origin,
    need: "coverage_status",
    memberId: session.member?.memberId ?? "",
    planId: session.member?.planId ?? "",
    overlay: session.overlay,
  });
  pushRouterTrace(session, {
    routesUsed: routed.routesUsed,
    latencyMs: routed.latencyMs,
    retrieved: routed.retrieved,
    rejected: routed.rejected,
    ranked: routed.ranked,
    injectedDelayMs: 0,
  });
  const c = routed.evidence.coverage;
  if (!c) return;
  session.coverage = c;
  upsertNeed(session, "coverage_status", {
    status: "active",
    guidance: "ready",
    flowStep: "check case → recommend destination",
  });
  setFocus(session, "coverage_status", "check case → recommend destination");
  const pending = c.status.toLowerCase() === "pending_review";
  showNow(session, {
    title: "Coverage case status (read only)",
    body: pending
      ? `The request is still under review; this record does not show an approval yet. ${c.caseId}: ${c.requestedMedication}, status ${c.status}. Pending is not denied. This role cannot make a determination.`
      : `${c.caseId} status ${c.status}. No determination is being made here.`,
    sourceLabel: "System record · coverage-review · simulated",
  });
  session.recommendation = {
    kind: "warm_transfer",
    title: "Recommend Coverage Review",
    body: transferOffer({
      caseId: c.caseId,
      requestedMedication: c.requestedMedication,
    }),
    sourceLabel: "Governed guidance · scripting · simulated",
    status: "pending",
  };
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
      : `Handoff draft unavailable. ${session.coverage?.caseId ?? "The coverage case"} remains pending review.`);
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
  });
  const json = (await resp.json()) as {
    data?: {
      transferId?: string;
      connectionStatus?: string;
      destinationQueue?: string;
    };
  };
  session.transfer.transferId = json.data?.transferId ?? "DEMO-TRANSFER001";
  session.transfer.connectionStatus =
    json.data?.connectionStatus ?? "receiving_specialist_connected";
  session.disposition.recommended = "TRANSFERRED_COVERAGE_REVIEW";
  upsertNeed(session, "coverage_status", {
    status: "unresolved_gap",
    flowStep: "connected — case still pending",
  });
  fillWrapOutcome(session);
  showNow(session, {
    title: "Connection result",
    body: `${session.transfer.transferId}: ${session.transfer.connectionStatus}. ${session.coverage?.caseId ?? "The coverage case"} remains pending. Connection is not a coverage determination.`,
    sourceLabel: "System record · telephony · simulated",
  });
  return { ok: true as const };
}

export function confirmDisposition(session: SessionState, code: string) {
  if (code === "TRANSFERRED_COVERAGE_REVIEW" && !session.transfer.connectionStatus) {
    return;
  }
  if (code === "COMPLETED_SERVICING") {
    session.disposition.confirmed = code;
    return;
  }
  if (!session.transfer.connectionStatus) return;
  session.disposition.confirmed = code;
}

export function saveWrap(session: SessionState, wrap: string) {
  session.wrapDraft = wrap;
}

function existingRequestCard(routed: Awaited<ReturnType<typeof routeQuery>>) {
  const refill = routed.evidence.refill ?? {};
  const id = (refill.requestId as string) ?? "DEMO-RF001";
  const pharmacy =
    (refill.pharmacyName as string) ??
    ((refill.provider as { organizationName?: string } | undefined)
      ?.organizationName ?? "the recorded pharmacy");
  const status = (refill.fillStatus as string) ?? "received";
  return {
    title: "Existing refill request",
    body: `Existing request ${id} at ${pharmacy} is on file (fillStatus ${status}). This confirms the request exists; it does not establish that it is ready today. No new order is created.`,
    sourceLabel: "System record · pharmacy · simulated",
  };
}

function freshReadyCard(routed: Awaited<ReturnType<typeof routeQuery>>) {
  const fresh = routed.evidence.refillFresh ?? {};
  const pharmacy =
    (fresh.pharmacyName as string) ??
    ((routed.evidence.refill?.pharmacyName as string) ?? "the recorded pharmacy");
  return {
    title: "Refill status (fresh read)",
    body: `The pharmacy's current status says it is ready for pickup. Source: ${pharmacy} request ${(fresh.requestId as string) ?? (routed.evidence.refill?.requestId as string) ?? "the recorded request"}. Do not treat this as an order, collection, or pickup confirmation.`,
    sourceLabel: "System record · pharmacy · simulated",
  };
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
  const trigger = await classifyPricingTrigger(session, line);
  const suppressRepeat = Boolean(trigger.fired && session.pricingExactDelivered);
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
    session.pricing = "due_now";
    if (
      session.needs.some(
        (n) => n.kind === "prospective_comparison" && n.status !== "resolved",
      )
    ) {
      session.estimateSpokenWithoutReading = true;
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
    }
  }
  if (line.stability === "final" || line.stability === "corrected") {
    if (!trigger.fired || suppressRepeat) assessPricingSpeech(session, line);
  }
  assessClosing(session, line);
}

function syntheticRefillRoute(
  session: SessionState,
  mode: "existing" | "fresh_status",
): RouterResult | null {
  if (!session.prefetch) return null;
  return {
    routesUsed: ["structured_lookup"],
    latencyMs: 0,
    retrieved: [],
    rejected: [],
    ranked: [],
    injectedDelayMs: 0,
    evidence: {
      claims: [],
      classifications: [],
      selectedPolicy: null,
      refill: session.prefetch.refill,
      refillFresh: mode === "fresh_status" ? session.prefetch.refillFresh : null,
      chargesEstablished: false,
      causeSupported: false,
      missing: [],
      fast90: session.prefetch.fast90,
      quotes: [],
      coverage: null,
    },
  };
}

async function applyInterpretation(
  session: SessionState,
  origin: string,
  line: { id: string; speaker: string; stability: string; text: string },
  interp: Interpretation,
  commitConsent: boolean,
) {
  const servicingFlags =
    interp.refillCheck !== "none" ||
    interp.historicalAsked ||
    interp.ninetyDayAsked ||
    interp.coverageAsked ||
    Boolean(interp.quotePharmacy) ||
    interp.firmRefusal ||
    interp.withdrawEnrollment ||
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
    interp.callTypeChange !== session.callType &&
    interp.callTypeChange !== "Refill"
  ) {
    if (interp.callTypeChange !== "Pricing") {
      session.callType = interp.callTypeChange;
    }
  }

  const memberId = session.member?.memberId ?? "";
  const planId = session.member?.planId ?? "";

  if (interp.refillCheck === "existing_request") {
    upsertNeed(session, "refill_status", {
      status: "active",
      guidance: "preparing",
      flowStep: "verify → check existing request",
    });
    setFocus(session, "refill_status", "verify → check existing request");
    const routed =
      syntheticRefillRoute(session, "existing") ??
      (await routeQuery({
        origin,
        need: "refill_status",
        memberId,
        planId,
        overlay: session.overlay,
        refillMode: "existing",
      }));
    pushRouterTrace(session, {
      routesUsed: routed.routesUsed,
      latencyMs: routed.latencyMs,
      retrieved: routed.retrieved,
      rejected: routed.rejected,
      ranked: routed.ranked,
      injectedDelayMs: 0,
    });
    const card = existingRequestCard(routed);
    upsertNeed(session, "refill_status", {
      guidance: "ready",
      flowStep: "verify → check existing request",
      answer: card,
    });
    showNow(session, card);
  }

  if (interp.historicalAsked) {
    upsertNeed(session, "historical_price", {
      status: "requested",
      guidance: "preparing",
      flowStep: "identify matching purchases → retrieve applied policy/evidence",
      queryText: line.text,
      sourceUtteranceId: line.id,
    });
    if (interp.refillCheck === "none" && !interp.returnToHistorical) {
      setFocus(
        session,
        "historical_price",
        "identify matching purchases → retrieve applied policy/evidence",
      );
    }
    const jobKey = `${session.sessionId}:historical`;
    if (!historicalJobs.has(jobKey)) {
      historicalJobs.add(jobKey);
      void runHistorical(session, origin, line.text, {
        injectedDelayMs: session.injectedDelayMs,
        recheck: false,
      });
    }
  }

  if (interp.refillCheck === "current_readiness") {
    const hist = getNeed(session, "historical_price");
    if (hist && hist.status !== "resolved") {
      upsertNeed(session, "historical_price", {
        status: "deferred",
        guidance:
          hist.guidance === "ready" || hist.answer
            ? "deferred_valid"
            : "preparing",
        flowStep:
          "identify matching purchases → retrieve applied policy/evidence → deferred (valid)",
      });
    }
    setFocus(
      session,
      "refill_status",
      "check existing request → explain status (fresh)",
    );
    const routed =
      syntheticRefillRoute(session, "fresh_status") ??
      (await routeQuery({
        origin,
        need: "refill_status",
        memberId,
        planId,
        overlay: session.overlay,
        refillMode: "fresh_status",
      }));
    pushRouterTrace(session, {
      routesUsed: routed.routesUsed,
      latencyMs: routed.latencyMs,
      retrieved: routed.retrieved,
      rejected: routed.rejected,
      ranked: routed.ranked,
      injectedDelayMs: 0,
    });
    const card = freshReadyCard(routed);
    upsertNeed(session, "refill_status", {
      status: "active",
      guidance: "ready",
      flowStep: "explain status (fresh READY_FOR_PICKUP)",
      answer: card,
    });
    showNow(session, card);
  }

  if (commitConsent && interp.communicatedRefillReadiness) {
    upsertNeed(session, "refill_status", {
      status: "resolved",
      flowStep: "explain status → wrap path",
    });
    maybeOfferComparison(session);
  }

  if (commitConsent && interp.returnToHistorical && getNeed(session, "historical_price")) {
    await promoteHistorical(session, origin);
  }

  if (interp.serviceIntroducedByAdvocate && line.speaker === "advocate") {
    markServiceDiscussed(session);
  }

  if (interp.ninetyDayAsked) {
    markServiceDiscussed(session);
    if (getNeed(session, "service_education")?.guidance !== "ready") {
      await loadFast90(session, origin);
    }
  }

  if (commitConsent && interp.retailHesitation && !session.optionalWorkSuppressed) {
    session.recommendation = {
      kind: "objection_retail",
      title: "Governed hesitation response",
      body: OBJECTION_BODY,
      sourceLabel: "Governed guidance · scripting · simulated",
      status: "pending",
    };
  }

  if (commitConsent && interp.firmRefusal) {
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

  if (
    commitConsent &&
    interp.comparisonConsent === "hedge" &&
    !session.optionalWorkSuppressed
  ) {
    session.consent.comparison = "hedge";
    session.consent.clarification = CLARIFY_INTEREST;
    showNow(session, {
      title: "Clarify comparison interest",
      body: CLARIFY_INTEREST,
      sourceLabel: "Governed guidance · scripting · simulated",
    });
  }

  if (
    commitConsent &&
    interp.comparisonConsent === "absolute_yes" &&
    !session.optionalWorkSuppressed
  ) {
    session.consent.comparison = "absolute_yes";
    session.consent.clarification = null;
    if (
      !interp.quotePharmacy &&
      !interp.quotePharmacyCorrection &&
      session.quotes.length === 0
    ) {
      await loadQuotes(session, origin);
    }
  }

  if (
    (interp.quotePharmacy || interp.quotePharmacyCorrection) &&
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
      );
    }
  }

  if (commitConsent && interp.electionMetforminOnly) {
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
      });
      setFocus(session, "service_election", "enroll/decline — scoped election");
      session.enrollment.medications = meds;
      session.enrollment.readback = sessionEnrollmentReadback(session);
      session.enrollment.confirmed = false;
      session.enrollment.submitted = false;
      showNow(session, {
        title: "Enrollment draft — scoped",
        body: session.enrollment.readback,
        sourceLabel: "Governed guidance · scripting · simulated",
      });
    }
  }

  if (commitConsent && interp.enrollmentConsent === "hedge") {
    session.consent.enrollment = "hedge";
    session.consent.clarification =
      "To confirm: do you want to submit the enrollment we just read back?";
  }

  if (
    commitConsent &&
    interp.enrollmentConsent === "absolute_yes" &&
    !session.enrollment.withdrawn
  ) {
    session.consent.enrollment = "absolute_yes";
    session.consent.clarification = null;
  }

  if (commitConsent && interp.withdrawEnrollment) {
    applyHumanWithdrawEnrollment(session);
  }

  if (interp.coverageAsked) {
    await loadCoverage(session, origin);
  }

  if (interp.advocateOfferedTransfer && session.coverage) {
    if (session.closing === "pending_later") session.closing = "due_now";
  }

  if (interp.memberAgreesTransfer && session.coverage) {
    upsertNeed(session, "coverage_status", {
      flowStep: "member agreed → awaiting human destination confirm",
    });
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
  const [existing, fresh, hist, edu] = await Promise.all([
    routeQuery({
      origin,
      need: "refill_status",
      memberId,
      planId,
      overlay: session.overlay,
      refillMode: "existing",
    }),
    routeQuery({
      origin,
      need: "refill_status",
      memberId,
      planId,
      overlay: session.overlay,
      refillMode: "fresh_status",
    }),
    routeQuery({
      origin,
      need: "historical_price",
      memberId,
      planId,
      overlay: session.overlay,
      queryText: "",
    }),
    routeQuery({
      origin,
      need: "service_education",
      memberId,
      planId,
      overlay: session.overlay,
    }),
  ]);
  session.prefetch = {
    refill: existing.evidence.refill,
    refillFresh: fresh.evidence.refillFresh,
    claims: hist.evidence.claims,
    classifications: hist.evidence.classifications,
    fast90: edu.evidence.fast90,
  };
}

async function applyCodeNeeds(
  session: SessionState,
  origin: string,
  line: { speaker: string; stability: string; text: string },
) {
  if (line.stability === "uncertain") return;
  const text = line.text;
  if (line.speaker === "member" && /90[\s-]?day/i.test(text)) {
    markServiceDiscussed(session);
    await loadFast90(session, origin);
  }
  if (
    line.speaker === "member" &&
    /please compare|compare both/i.test(text) &&
    !session.optionalWorkSuppressed
  ) {
    session.consent.comparison = "absolute_yes";
    session.consent.clarification = null;
    if (session.quotes.length === 0) await loadQuotes(session, origin);
  }
  if (line.speaker === "advocate" && /ready for pickup/i.test(text)) {
    upsertNeed(session, "refill_status", {
      status: "resolved",
      flowStep: "explain status → wrap path",
    });
    maybeOfferComparison(session);
    await maybeCompleteServicing(session);
  }
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
  await applyAdvocateObligations(session, line);
  if (line.stability === "uncertain") return;
  if (session.identityStatus !== "VALID") return;
  await applyCodeNeeds(session, origin, line);
  void (async () => {
    const interp = await interpretUtterance(session, line);
    appendJsonl(session.sessionId, {
      kind: "luna_interpret",
      eventId: line.id,
      ms: interp.ms,
      ok: interp.ok,
    });
    session.lastInterpretation = {
      eventId: line.id,
      ...interp,
      raw: interp.raw.slice(0, 500),
    };
    if (!interp.ok) {
      if (line.stability !== "partial") {
        showNow(session, {
          title: "Interpretation unavailable",
          body: "Fast-tier interpretation did not return. No member conclusion was invented.",
          sourceLabel: "Governed guidance · scripting · simulated",
        });
        publishSession(session);
      }
      return;
    }
    await applyInterpretation(
      session,
      origin,
      line,
      interp,
      line.stability === "final" || line.stability === "corrected",
    );
    publishSession(session);
  })();
}
