"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeWith, outcomeWithout } from "@/lib/copy";
import { quoteAmountsMayRender } from "@/lib/utteranceRules";
import type { NeedKind, SessionState } from "@/lib/types";

type StreamEvent = {
  id: string;
  offsetMs: number;
  type: string;
  name?: string;
  speaker?: string;
  stability?: "partial" | "final" | "corrected" | "uncertain";
  text?: string;
  correctsEventId?: string;
  pauseLabel?: string;
};

type ScenarioKind =
  | "t01_m2a"
  | "t02a"
  | "t03a"
  | "t03b"
  | "t04b"
  | "t06a"
  | "t08b";

const SCENARIO_OVERLAY: Record<ScenarioKind, string | null> = {
  t01_m2a: null,
  t02a: null,
  t03a: null,
  t03b: null,
  t04b: "T04B",
  t06a: "T06A",
  t08b: "T08B",
};

const OBLIGATION_LABEL: Record<string, string> = {
  not_applicable: "Not applicable",
  due_now: "Due now",
  exact_timely: "Exact / timely",
  paraphrased: "Paraphrased",
  pending_later: "Pending later",
  late_finding: "Late / finding",
  unable_to_verify: "Unable to verify",
};

export default function Page() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclosureNetwork, setDisclosureNetwork] = useState<string>("");
  const [enrollToken, setEnrollToken] = useState<string | null>(null);
  const pausedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  const ingest = useCallback(async (event: StreamEvent) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const clientT = Date.now();
    const resp = await fetch("/api/session/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        event: { ...event, clientT },
      }),
    });
    const json = (await resp.json()) as { session?: SessionState };
    if (json.session) {
      setSession(json.session);
      pausedRef.current = json.session.paused;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const paint = await fetch("/api/session/paint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        eventId: event.id,
        kind: event.type,
        tEvent: clientT,
        tPaint: Date.now(),
      }),
    });
    const painted = (await paint.json()) as { session?: SessionState };
    if (painted.session) setSession(painted.session);
  }, []);

  const playEvents = useCallback(
    async (events: StreamEvent[]) => {
      let last = 0;
      for (const ev of events) {
        const gap = Math.max(0, ev.offsetMs - last);
        last = ev.offsetMs;
        if (gap) await new Promise((r) => setTimeout(r, gap));
        while (pausedRef.current) {
          await new Promise((r) => setTimeout(r, 100));
        }
        await ingest(ev);
      }
    },
    [ingest],
  );

  async function startCall(kind: ScenarioKind) {
    setBusy(true);
    setError(null);
    try {
      const disc = await fetch("/api/simulated/scripting/disclosures", {
        cache: "no-store",
      });
      setDisclosureNetwork(
        `GET ${disc.url} → ${disc.status} (browser Network tab)`,
      );
      const start = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: kind,
          overlay: SCENARIO_OVERLAY[kind],
          injectedDelayMs: kind.startsWith("t01") ? 2800 : 0,
        }),
      });
      const startJson = (await start.json()) as { session: SessionState };
      sessionIdRef.current = startJson.session.sessionId;
      setSession(startJson.session);
      setEnrollToken(null);
      pausedRef.current = false;
      const stream = await fetch(
        `/api/simulated/telephony/scenario-events?id=${kind}`,
        { cache: "no-store" },
      );
      const streamJson = (await stream.json()) as {
        data?: { events?: StreamEvent[] };
      };
      playEvents(streamJson.data?.events ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!session) return;
    const resp = await fetch("/api/session/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId }),
    });
    const json = (await resp.json()) as { session: SessionState };
    setSession(json.session);
    pausedRef.current = false;
  }

  async function human(path: string, extra: Record<string, unknown> = {}) {
    if (!session) return;
    const resp = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, ...extra }),
    });
    const json = (await resp.json()) as {
      session?: SessionState;
      token?: string;
    };
    if (json.token) setEnrollToken(json.token);
    if (json.session) setSession(json.session);
  }

  async function selectFocus(kind: NeedKind) {
    if (!session) return;
    const resp = await fetch("/api/session/human/set-focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, kind }),
    });
    const json = (await resp.json()) as { session: SessionState };
    setSession(json.session);
  }

  useEffect(() => {
    const sid = session?.sessionId;
    if (!sid) return;
    const es = new EventSource(`/api/session/events?sessionId=${sid}`);
    es.onmessage = (ev) => {
      try {
        const json = JSON.parse(ev.data) as { session?: SessionState };
        if (json.session) {
          setSession(json.session);
          pausedRef.current = json.session.paused;
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  }, [session?.sessionId]);

  const greetingReq = session?.disclosures.find(
    (d) => d.requirementId === "DEMO-GREETING-v1",
  );
  const pricingReq = session?.disclosures.find(
    (d) => d.requirementId === "DEMO-PRICING-v1",
  );
  const closingReq = session?.disclosures.find(
    (d) => d.requirementId === "DEMO-CLOSING-v2",
  );
  const memberVisible = session?.auth?.decision.toLowerCase() === "valid";
  const lastRouter =
    session?.diagnostics.router[session.diagnostics.router.length - 1];
  const rejectedOther = session?.diagnostics.router
    .flatMap((r) => r.rejected)
    .filter((x) => x.id === "DEMO-POLICY-OTHER-v1");

  return (
    <main className={session?.paused ? "workspace paused" : "workspace"}>
      <p className="banner">
        Prototype workspace standing in for an embedded advocate desktop.
        Telephony, identity, and business systems are{" "}
        <strong>simulated</strong>. Required wording is registry text. M3
        replays T02A–T08B.
      </p>

      <header className="strip">
        <dl>
          <div>
            <dt>Identity / role</dt>
            <dd>
              {memberVisible
                ? `${session?.member?.name.given} ${session?.member?.name.family} · ${session?.auth?.role} · ${session?.identityStatus}`
                : `Unverified · simulated authorization pending`}
            </dd>
          </div>
          <div>
            <dt>Call type</dt>
            <dd>{session?.callType ?? "—"}</dd>
          </div>
          <div>
            <dt>Need / step</dt>
            <dd>
              {session
                ? `${session.currentNeed} · ${session.flowStep}`
                : "Not started"}
            </dd>
          </div>
          <div>
            <dt>Elapsed (excl. pause)</dt>
            <dd>
              {session ? `${(session.elapsedMs / 1000).toFixed(1)}s` : "—"}
            </dd>
          </div>
        </dl>
        <div className="strip-actions">
          {!session && (
            <>
              <button disabled={busy} onClick={() => startCall("t01_m2a")}>
                Start main call
              </button>
              {(
                [
                  ["t02a", "T02A"],
                  ["t03a", "T03A"],
                  ["t03b", "T03B"],
                  ["t04b", "T04B"],
                  ["t06a", "T06A"],
                  ["t08b", "T08B"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className="secondary"
                  disabled={busy}
                  onClick={() => startCall(id)}
                >
                  Replay {label}
                </button>
              ))}
            </>
          )}
          {session?.paused && (
            <button className="secondary" onClick={resume}>
              Resume (presenter pause only)
            </button>
          )}
        </div>
      </header>

      <aside className="rail">
        <h2>Obligations</h2>
        <div className="ob-status">
          <strong>DEMO-GREETING-v1</strong>
          <span className={session?.greeting === "exact_timely" ? "exact" : ""}>
            {session ? OBLIGATION_LABEL[session.greeting] : "Not applicable yet"}
          </span>
          <span className="source">
            Governed guidance · scripting · simulated
          </span>
        </div>
        {greetingReq && (
          <details>
            <summary>Exact greeting text</summary>
            <p>{greetingReq.verbatimText}</p>
          </details>
        )}
        <div className="ob-status">
          <strong>DEMO-PRICING-v1</strong>
          <span>
            {session ? OBLIGATION_LABEL[session.pricing] : "Not applicable"}
          </span>
          <span className="source">
            Historical charges do not trigger this statement.
          </span>
        </div>
        {pricingReq && (
          <details>
            <summary>Exact pricing text</summary>
            <p>{pricingReq.verbatimText}</p>
          </details>
        )}
        <div className="ob-status">
          <strong>DEMO-CLOSING-v2</strong>
          <span>
            {session ? OBLIGATION_LABEL[session.closing] : "Not applicable"}
          </span>
          <span className="source">
            Clicking Offer does not create this obligation.
          </span>
        </div>
        {closingReq && (
          <details>
            <summary>Exact closing text</summary>
            <p>{closingReq.verbatimText}</p>
            {session?.closingNote && (
              <p className="source">{session.closingNote}</p>
            )}
          </details>
        )}
      </aside>

      <section className="now">
        <h2>Now</h2>
        {session?.paused && (
          <p className="pause-banner">
            <span className="mark">Paused</span>
            {" "}
            Presenter-gated pause — excluded from machine response time.
          </p>
        )}
        {session?.nudge && (
          <div className="nudge">
            <strong>{session.nudge.template}</strong>
            {session.nudge.requiredText && (
              <p>{session.nudge.requiredText}</p>
            )}
            {session.nudge.heard && (
              <p className="diff">
                Heard: {session.nudge.heard}
                <br />
                Missing: {(session.nudge.missingFromHeard ?? []).join(", ") || "—"}
                <br />
                Extra: {(session.nudge.extraInHeard ?? []).join(", ") || "—"}
              </p>
            )}
          </div>
        )}
        {session?.pricingNote && <p className="exact">{session.pricingNote}</p>}
        <h3 className="now-title">
          {session?.nowCard.title ?? "Opening"}
        </h3>
        <p>
          {session?.nowCard.body ?? "Start the call to load the workspace."}
        </p>
        <p className="source">{session?.nowCard.sourceLabel}</p>
        {session && (
          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => human("/api/session/human/view-evidence")}
            >
              View evidence
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() =>
                human("/api/session/human/flag-issue", {
                  note: "Advocate flagged the current Now card",
                })
              }
            >
              Flag issue
            </button>
          </div>
        )}
        {session?.openEvidence && (
          <div>
            <h3 className="subhead">Opened record</h3>
            <p>{session.openEvidence.title}</p>
            <p>{session.openEvidence.body}</p>
            <p className="source">{session.openEvidence.sourceLabel}</p>
          </div>
        )}
        {session?.recommendation?.status === "pending" && (
          <div className="actions">
            {session.recommendation.kind === "optional_comparison" && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    human("/api/session/human/offer", { decision: "offer" })
                  }
                >
                  Offer
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    human("/api/session/human/offer", { decision: "dismiss" })
                  }
                >
                  Dismiss
                </button>
              </>
            )}
            {session.recommendation.kind === "warm_transfer" && (
              <button
                type="button"
                onClick={() => human("/api/session/human/confirm-transfer")}
              >
                Confirm Coverage Review destination
              </button>
            )}
            <p className="source">{session.recommendation.body}</p>
          </div>
        )}
        {session &&
          session.quotes.length > 0 &&
          quoteAmountsMayRender(session.consent.comparison) &&
          session.pricing !== "due_now" &&
          session.pricingExactDelivered && (
          <table className="quote-table">
            <thead>
              <tr>
                <th>Drug</th>
                <th>Pharmacy</th>
                <th>90-day estimate</th>
                <th>Validity</th>
              </tr>
            </thead>
            <tbody>
              {session.quotes.map((q) => (
                <tr key={q.quoteId}>
                  <td>{q.drugName}</td>
                  <td>{q.pharmacyName}</td>
                  <td>${q.estimatedMemberCost.value}</td>
                  <td>{q.validityStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {session?.enrollment.readback && (
          <div>
            <p className="source">
              Draft scope: {session.enrollment.medications.join(", ") || "none"}.
              Comparison interest is not enrollment authorization.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={session.consent.enrollment !== "absolute_yes"}
                onClick={() =>
                  human("/api/session/human/mint-enrollment-token", {
                    scope: { medications: session.enrollment.medications },
                  })
                }
              >
                Confirm (mint token)
              </button>
              <button
                type="button"
                disabled={!enrollToken || !session.enrollment.confirmed || session.enrollment.withdrawn}
                onClick={() =>
                  human("/api/session/human/submit-enrollment", {
                    token: enrollToken,
                  })
                }
              >
                Submit enrollment
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  const quoted = [
                    ...new Set(session.quotes.map((q) => q.drugName)),
                  ];
                  const extra = quoted.filter(
                    (d) =>
                      !session.enrollment.medications.some(
                        (m) => m.toLowerCase() === d.toLowerCase(),
                      ),
                  );
                  human("/api/session/human/edit-enrollment-scope", {
                    medications: [
                      ...session.enrollment.medications,
                      ...(extra.length ? extra : ["atorvastatin"]),
                    ],
                  });
                }}
              >
                Add atorvastatin to draft
              </button>
              <button
                className="secondary"
                type="button"
                disabled={session.enrollment.withdrawn}
                onClick={() => human("/api/session/human/withdraw-enrollment")}
              >
                Withdraw enrollment
              </button>
            </div>
            {session.enrollment.resultId && (
              <p>
                Returned {session.enrollment.resultId} scope{" "}
                {(session.enrollment.returnedScope ?? []).join(", ")}.{" "}
                {session.enrollment.scopeOk
                  ? `Matches confirmed scope (${(session.enrollment.returnedScope ?? []).join(", ")}).`
                  : "Scope mismatch — not a success."}
              </p>
            )}
          </div>
        )}
        {session?.coverage && (
          <p className="source">
            {session.coverage.caseId}: {session.coverage.requestedMedication} ·{" "}
            {session.coverage.status} · determination{" "}
            {session.coverage.determination ?? "null"}
          </p>
        )}
        {session?.handoffDraft && (
          <div>
            <h3 className="subhead">Handoff draft</h3>
            <p>{session.handoffDraft}</p>
            {!session.transfer.destinationConfirmed && (
              <button
                type="button"
                onClick={() => human("/api/session/human/confirm-transfer")}
              >
                Confirm Coverage Review destination
              </button>
            )}
          </div>
        )}
        {session?.transfer.destinationConfirmed &&
          session.closing === "exact_timely" &&
          !session.transfer.connectionStatus && (
            <div className="actions">
              <button
                type="button"
                onClick={() => human("/api/session/human/execute-transfer")}
              >
                Execute transfer
              </button>
            </div>
          )}
        {session?.transfer.connectionStatus && (
          <p>
            {session.transfer.transferId}: {session.transfer.connectionStatus}.
            Coverage case {session.coverage?.caseId} remains{" "}
            {session.coverage?.status ?? "unreturned"}.
          </p>
        )}
        {session?.wrapDraft && (
          <div>
            <h3 className="subhead">Wrap (editable)</h3>
            <textarea
              className="wrap"
              defaultValue={session.wrapDraft}
              key={session.wrapDraft.slice(0, 40)}
              onBlur={(e) =>
                human("/api/session/human/save-wrap", { wrap: e.target.value })
              }
            />
          </div>
        )}
        {session?.disposition.recommended && (
          <div className="actions">
            <button
              type="button"
              disabled={Boolean(session.disposition.confirmed)}
              onClick={() =>
                human("/api/session/human/confirm-disposition", {
                  code: session.disposition.recommended,
                })
              }
            >
              Confirm {session.disposition.recommended}
            </button>
            {session.disposition.confirmed && (
              <span className="exact">
                Confirmed {session.disposition.confirmed}
              </span>
            )}
          </div>
        )}
        {session?.outcomeReady && (
          <div className="outcome">
            <h3 className="subhead">End-of-demo outcome (said once)</h3>
            {session.pricing === "late_finding" ? (
              <>
                <p>
                  {outcomeWithout({
                    historicalNeed:
                      session.needs.find((n) => n.kind === "historical_price")
                        ?.answer?.title ?? "historical-charge",
                  })}
                </p>
                <p>
                  {outcomeWith({
                    memberGiven: session.member?.name.given ?? "the member",
                  })}{" "}
                  This is not a measured Humana baseline. Do not describe the
                  pricing moment as prevention.
                </p>
              </>
            ) : (
              <p>
                This run did not record a recovered pricing-timing miss. Outcome
                copy is not claiming a caught miss.
              </p>
            )}
            <p className="source">
              Greeting {session.greeting}; pricing {session.pricing}
              {session.pricingNote ? ` (${session.pricingNote})` : ""}; closing{" "}
              {session.closing}
              {session.closingNote ? ` (${session.closingNote})` : ""}.
              Enrollment {session.enrollment.resultId ?? "none"} scope{" "}
              {(session.enrollment.returnedScope ?? []).join(", ") || "n/a"}.
              Coverage {session.coverage?.caseId} {session.coverage?.status};
              connection {session.transfer.connectionStatus ?? "none"};
              disposition {session.disposition.confirmed ?? "unconfirmed"}.
            </p>
          </div>
        )}
        {error && <p>{error}</p>}
      </section>

      <aside className="drawer">
        <h2>Context</h2>
        {!memberVisible && (
          <p>
            Protected member fields withheld until simulated identity-and-role
            authorization (DEMO-AUTH001).
          </p>
        )}
        {memberVisible && session?.member && (
          <p>
            {session.member.name.given} {session.member.name.family}
            <br />
            Plan {session.member.planId} ({session.member.lineOfBusiness})
          </p>
        )}
        <p className="source">
          {memberVisible
            ? "System record · eligibility · simulated"
            : "System record · telephony · simulated"}
        </p>
        <h3 className="subhead">Open needs</h3>
        {(session?.needs ?? []).length === 0 && <p>None yet.</p>}
        {(session?.needs ?? []).map((need) => (
          <div key={need.kind} className="need">
            <div className="need-head">
              <strong>{need.kind.replace(/_/g, " ")}</strong>
              <span className="mark">{need.status}</span>
              {need.guidance === "deferred_valid" && (
                <span className="mark">Answer ready</span>
              )}
            </div>
            <p className="source">{need.flowStep}</p>
            <button
              className="secondary"
              type="button"
              onClick={() => selectFocus(need.kind)}
            >
              Make this the focus
            </button>
          </div>
        ))}
        <details className="diagnostics">
          <summary>Diagnostics (not advocate default)</summary>
          <pre>
            {disclosureNetwork}
            {"\n"}
            overlay: {session?.overlay ?? "none"}
            {"\n"}
            {session?.diagnostics.disclosureFetch}
            {"\n"}
            {session?.diagnostics.warmup}
            {"\n"}
            {session?.diagnostics.embeddings}
            {"\n"}
            rejected OTHER: {JSON.stringify(rejectedOther)}
            {"\n"}
            last routes: {JSON.stringify(lastRouter, null, 2)}
            {"\n"}
            triggers: {JSON.stringify(session?.diagnostics.triggers, null, 2)}
            {"\n"}
            rechecks: {JSON.stringify(session?.diagnostics.rechecks)}
            {"\n"}
            interpretation: {JSON.stringify(session?.lastInterpretation, null, 2)}
          </pre>
        </details>
      </aside>

      <section className="transcript">
        <h2>Transcript</h2>
        {(session?.transcript ?? []).map((line) => (
          <p key={line.id} className="line">
            <span
              className={
                line.stability === "uncertain" ? "mark mark-uncertain" : "mark"
              }
            >
              {line.stability === "uncertain" ? "UNCERTAIN" : line.stability}
            </span>
            <span className="mark">{line.speaker}</span>
            {line.text}
            {line.correctsEventId ? ` (corrects ${line.correctsEventId})` : ""}
          </p>
        ))}
      </section>
    </main>
  );
}
