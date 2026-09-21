import type { SessionState } from "@/lib/types";

export type StreamEvent = {
  id: string;
  offsetMs: number;
  type: string;
  name?: string;
  speaker?: string;
  stability?: string;
  text?: string;
  correctsEventId?: string;
  pauseLabel?: string;
};

const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";

async function json(path: string, init?: RequestInit) {
  const resp = await fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await resp.json()) as {
    session?: SessionState;
    token?: string;
    data?: { events?: StreamEvent[] };
    error?: string;
  };
  return { status: resp.status, body };
}

export async function originUp(): Promise<boolean> {
  try {
    const resp = await fetch(`${ORIGIN}/api/simulated/scripting/disclosures`);
    return resp.ok;
  } catch {
    return false;
  }
}

async function human(
  sessionId: string,
  path: string,
  extra: Record<string, unknown> = {},
) {
  return json(path, {
    method: "POST",
    body: JSON.stringify({ sessionId, ...extra }),
  });
}

async function act(session: SessionState, tokenRef: { token: string | null }) {
  const label = session.lastPauseLabel ?? "";
    if (
    session.recommendation?.status === "pending" &&
    session.recommendation.kind === "optional_comparison" &&
    /Offer|comparison/i.test(label)
  ) {
    const r = await human(session.sessionId, "/api/session/human/offer", {
      decision: session.overlay === "T06A" ? "dismiss" : "offer",
    });
    if (r.body.session) Object.assign(session, r.body.session);
  }
  if (
    session.recommendation?.status === "pending" &&
    session.recommendation.kind === "objection_retail"
  ) {
    const r = await human(session.sessionId, "/api/session/human/use-objection");
    if (r.body.session) Object.assign(session, r.body.session);
  }
  if (
    /Add atorvastatin/i.test(label) &&
    session.enrollment.medications.length === 1
  ) {
    const r = await human(
      session.sessionId,
      "/api/session/human/edit-enrollment-scope",
      { medications: ["metformin", "atorvastatin"] },
    );
    if (r.body.session) Object.assign(session, r.body.session);
    tokenRef.token = null;
  }
  if (
    session.consent.enrollment === "absolute_yes" &&
    !session.enrollment.confirmed &&
    !session.enrollment.withdrawn &&
    session.enrollment.medications.length > 0 &&
    /mint/i.test(label)
  ) {
    const r = await human(
      session.sessionId,
      "/api/session/human/mint-enrollment-token",
      { scope: { medications: session.enrollment.medications } },
    );
    if (r.body.token) tokenRef.token = r.body.token;
    if (r.body.session) Object.assign(session, r.body.session);
  }
  if (
    session.overlay !== "T08B" &&
    session.enrollment.confirmed &&
    !session.enrollment.submitted &&
    !session.enrollment.withdrawn &&
    tokenRef.token &&
    /Submit/i.test(label)
  ) {
    const r = await human(
      session.sessionId,
      "/api/session/human/submit-enrollment",
      { token: tokenRef.token },
    );
    if (r.body.session) Object.assign(session, r.body.session);
  }
  if (
    session.coverage &&
    !session.transfer.destinationConfirmed &&
    /Confirm (Coverage Review )?destination/i.test(label)
  ) {
    const r = await human(session.sessionId, "/api/session/human/confirm-transfer");
    if (r.body.session) Object.assign(session, r.body.session);
  }
  if (
    session.transfer.destinationConfirmed &&
    session.closing === "exact_timely" &&
    !session.transfer.connectionStatus &&
    /Execute transfer/i.test(label)
  ) {
    const t0 = Date.now();
    const r = await human(
      session.sessionId,
      "/api/session/human/execute-transfer",
    );
    if (r.body.session) Object.assign(session, r.body.session);
    await paint(session.sessionId, "wrap-generated", "wrap", t0);
  }
  if (
    session.disposition.recommended &&
    !session.disposition.confirmed &&
    /COMPLETED_SERVICING|TRANSFERRED_COVERAGE_REVIEW|confirm TRANSFERRED/i.test(
      label,
    )
  ) {
    const r = await human(
      session.sessionId,
      "/api/session/human/confirm-disposition",
      { code: session.disposition.recommended },
    );
    if (r.body.session) Object.assign(session, r.body.session);
  }
}

export async function runScenario(opts: {
  scenarioId: string;
  overlay?: string | null;
  compressMs?: number;
}): Promise<SessionState> {
  const start = await json("/api/session/start", {
    method: "POST",
    body: JSON.stringify({
      scenarioId: opts.scenarioId,
      overlay: opts.overlay ?? null,
      injectedDelayMs: opts.scenarioId.startsWith("t01") ? 2800 : 0,
    }),
  });
  const session = start.body.session;
  if (!session) throw new Error("start failed");
  const stream = await json(
    `/api/simulated/telephony/scenario-events?id=${opts.scenarioId}`,
  );
  const events = stream.body.data?.events ?? [];
  const tokenRef = { token: null as string | null };
  let last = 0;
  for (const ev of events) {
    const gap = Math.max(0, ev.offsetMs - last);
    last = ev.offsetMs;
    const wait = Math.min(gap, opts.compressMs ?? 40);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const tEvent = Date.now();
    const ingest = await json("/api/session/ingest", {
      method: "POST",
      body: JSON.stringify({
        sessionId: session.sessionId,
        event: { ...ev, clientT: tEvent },
      }),
    });
    if (ingest.body.session) Object.assign(session, ingest.body.session);
    await waitApplied(session, ev);
    if (ev.id === "e-return-met") {
      await waitNeedAnswer(session, "historical_price", 12_000);
    }
    if (ev.id === "e-90day" || ev.id === "e-90") {
      await waitNeedAnswer(session, "service_education", 12_000);
    }
    if (ev.id === "e-yes-compare") {
      await waitUntil(session, (s) => s.quotes.length > 0, 12_000, "quotes");
    }
    if (ev.id === "e-jardiance") {
      await waitUntil(session, (s) => Boolean(s.coverage), 12_000, "coverage");
    }
    await paint(session.sessionId, ev.id, ev.type, tEvent);
    await refresh(session);
    if (session.paused) {
      await act(session, tokenRef);
      const resumed = await json("/api/session/resume", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      if (resumed.body.session) Object.assign(session, resumed.body.session);
    }
  }
  if ((session.heldAdvocateLines ?? []).length) {
    await waitUntil(
      session,
      (s) => !(s.heldAdvocateLines ?? []).length,
      9_000,
      "held advocate lines flushed",
    );
  }
  if (opts.scenarioId === "t02a") {
    await waitUntil(
      session,
      (s) => Boolean(s.disposition.recommended),
      15_000,
      "t02a disposition",
    );
    await act(session, tokenRef);
    await refresh(session);
  }
  if (opts.scenarioId === "t01_m2a") {
    await waitUntil(
      session,
      (s) =>
        s.diagnostics.triggers.some(
          (t) => t.classification === "prospective_estimate" || t.fired,
        ) ||
        s.pricing === "late_finding" ||
        s.pricing === "exact_timely",
      12_000,
      "pricing trigger classification",
    );
    await waitUntil(
      session,
      (s) => Boolean(s.wrapDraft),
      20_000,
      "wrap draft",
    );
    await waitUntil(
      session,
      (s) => Boolean(s.handoffDraft),
      20_000,
      "handoff draft",
    );
  }
  if (opts.overlay === "T04B" || opts.overlay === "T06A" || opts.scenarioId === "t06a") {
    if (opts.overlay === "T06A" || opts.scenarioId === "t06a") {
      await waitUntil(
        session,
        (s) => pastChargesOnScreen(s),
        20_000,
        "T06A charges on screen",
      );
    } else {
      await waitUntil(
        session,
        (s) => {
          const lake = s.quotes.filter(
            (q) =>
              /lakeview/i.test(q.pharmacyName) && /metformin/i.test(q.drugName),
          );
          const oak = s.quotes.filter(
            (q) =>
              /oak street/i.test(q.pharmacyName) && /metformin/i.test(q.drugName),
          );
          return (
            lake.length > 0 &&
            lake.every((q) => q.validityStatus === "invalidated") &&
            oak.some((q) => q.validityStatus === "valid")
          );
        },
        8_000,
        "corrected-pharmacy quote invalidation",
      );
    }
  }
  dumpEvidence(session);
  return session;
}

export async function measureUtterance(opts: {
  scenarioId: string;
  replaceId: string;
  text: string;
  waitNeed?: string;
  waitQuotes?: boolean;
  compressMs?: number;
}): Promise<{
  session: SessionState;
  paintMs: number | null;
  paths: SessionState["diagnostics"]["needPaths"];
}> {
  const start = await json("/api/session/start", {
    method: "POST",
    body: JSON.stringify({
      scenarioId: opts.scenarioId,
      overlay: null,
      injectedDelayMs: 0,
    }),
  });
  const session = start.body.session;
  if (!session) throw new Error("start failed");
  const stream = await json(
    `/api/simulated/telephony/scenario-events?id=${opts.scenarioId}`,
  );
  const events = stream.body.data?.events ?? [];
  const tokenRef = { token: null as string | null };
  let last = 0;
  let paintMs: number | null = null;
  for (const raw of events) {
    const ev =
      raw.id === opts.replaceId ? { ...raw, text: opts.text } : raw;
    const gap = Math.max(0, ev.offsetMs - last);
    last = ev.offsetMs;
    const wait = Math.min(gap, opts.compressMs ?? 20);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const tEvent = Date.now();
    const ingest = await json("/api/session/ingest", {
      method: "POST",
      body: JSON.stringify({
        sessionId: session.sessionId,
        event: { ...ev, clientT: tEvent },
      }),
    });
    if (ingest.body.session) Object.assign(session, ingest.body.session);
    await waitApplied(session, ev);
    const target = ev.id === opts.replaceId;
    if (!target) {
      if (ev.id === "e-hist-final" || ev.id === "e-return-met") {
        await waitNeedAnswer(session, "historical_price", 12_000);
      }
      if (ev.id === "e-90day" || ev.id === "e-90") {
        await waitNeedAnswer(session, "service_education", 20_000);
      }
    } else {
      if (opts.waitNeed) await waitNeedAnswer(session, opts.waitNeed, 20_000);
      if (opts.waitQuotes) {
        await waitUntil(
          session,
          (s) =>
            s.consent.comparison === "absolute_yes" && s.quotes.length > 0,
          20_000,
          "absolute_yes quotes",
        );
      }
    }
    const tPaint = Date.now();
    await paint(session.sessionId, ev.id, ev.type, tEvent);
    if (ev.id === opts.replaceId) paintMs = tPaint - tEvent;
    await refresh(session);
    if (session.paused) {
      await act(session, tokenRef);
      const resumed = await json("/api/session/resume", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      if (resumed.body.session) Object.assign(session, resumed.body.session);
    }
    if (ev.id === opts.replaceId) break;
  }
  dumpEvidence(session);
  return { session, paintMs, paths: session.diagnostics.needPaths };
}

async function paint(
  sessionId: string,
  eventId: string,
  kind: string,
  tEvent: number,
) {
  await json("/api/session/paint", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      eventId,
      kind,
      tEvent,
      tPaint: Date.now(),
    }),
  });
}

async function refresh(session: SessionState) {
  const st = await json(`/api/session/state?sessionId=${session.sessionId}`);
  if (st.body.session) Object.assign(session, st.body.session);
}

async function waitApplied(
  session: SessionState,
  ev: { id: string; type: string; speaker?: string; stability?: string },
) {
  if (ev.type !== "transcript" || ev.stability === "partial") return;
  await waitUntil(
    session,
    (s) =>
      s.lastAppliedEventId === ev.id ||
      (s.appliedEventIds ?? []).includes(ev.id) ||
      (s.heldAdvocateLines ?? []).some((h) => h.id === ev.id),
    20_000,
    `applied ${ev.id}`,
  );
}

async function waitUntil(
  session: SessionState,
  pred: (s: SessionState) => boolean,
  ms: number,
  label = "condition",
) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await refresh(session);
    if (pred(session)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  await refresh(session);
  if (!pred(session)) {
    throw new Error(
      `waitUntil timed out after ${ms}ms waiting for ${label} (session ${session.sessionId})`,
    );
  }
}

function pastChargesOnScreen(session: SessionState) {
  const parts = [
    session.nowCard.body,
    session.nowCard.sourceLabel ?? "",
    ...(session.nowCard.statements ?? []).flatMap((st) => [
      st.text,
      st.sourceTag ?? "",
    ]),
    ...session.needs.flatMap((need) => [
      need.answer?.body ?? "",
      need.answer?.sourceLabel ?? "",
      ...(need.answer?.statements ?? []).flatMap((st) => [
        st.text,
        st.sourceTag ?? "",
      ]),
    ]),
  ].join("\n");
  return (
    /\$?8(\.00)?/.test(parts) &&
    /\$?27(\.00)?/.test(parts) &&
    /not confirmed/i.test(parts)
  );
}

async function waitNeedAnswer(
  session: SessionState,
  kind: string,
  ms: number,
) {
  await waitUntil(
    session,
    (s) => Boolean(s.needs.find((n) => n.kind === kind)?.answer?.body),
    ms,
    `${kind} answer`,
  );
}

function dumpEvidence(session: SessionState) {
  const { writeFileSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const hist = session.needs.find((n) => n.kind === "historical_price");
  const edu = session.needs.find((n) => n.kind === "service_education");
  writeFileSync(
    join(process.cwd(), "runs", `${session.sessionId}.evidence.json`),
    JSON.stringify(
      {
        sessionId: session.sessionId,
        scenarioId: session.scenarioId,
        overlay: session.overlay,
        greeting: session.greeting,
        pricing: session.pricing,
        pricingNote: session.pricingNote,
        closing: session.closing,
        closingNote: session.closingNote,
        closingHistory: session.closingHistory,
        firedTriggers: session.diagnostics.triggers.filter((t) => t.fired),
        triggerLog: session.diagnostics.triggers,
        router: session.diagnostics.router,
        historical: hist?.answer ?? null,
        fast90: edu?.answer ?? null,
        nowCard: session.nowCard,
        quotes: session.quotes,
        wrap: session.wrapDraft,
        handoff: session.handoffDraft,
        enrollment: session.enrollment,
        coverage: session.coverage,
        transfer: session.transfer,
        disposition: session.disposition,
        lastTimings: session.lastTimings,
        needPaths: session.diagnostics.needPaths,
        lookupProgress: session.lookupProgress ?? [],
        lookupReport: (session.lookupProgress ?? []).map((p) => ({
          question: p.question,
          firstStepMs:
            p.firstStepAt != null ? p.firstStepAt - p.startedAt : null,
          firstFactMs:
            p.firstFactAt != null ? p.firstFactAt - p.startedAt : null,
          fullAnswerMs:
            p.answeredAt != null ? p.answeredAt - p.startedAt : null,
          advocateWaitMs: p.advocateWaitMs,
        })),
      },
      null,
      2,
    ),
  );
}
