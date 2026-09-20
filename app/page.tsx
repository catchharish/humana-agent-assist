"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeWith, outcomeWithout } from "@/lib/copy";
import { quoteAmountsMayRender } from "@/lib/utteranceRules";
import type {
  NeedKind,
  ObligationStatus,
  SessionState,
  TranscriptLine,
} from "@/lib/types";

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

const SCENARIOS: { id: ScenarioKind; label: string }[] = [
  { id: "t01_m2a", label: "Main call (T01)" },
  { id: "t02a", label: "Replay T02A" },
  { id: "t03a", label: "Replay T03A" },
  { id: "t03b", label: "Replay T03B" },
  { id: "t04b", label: "Replay T04B" },
  { id: "t06a", label: "Replay T06A" },
  { id: "t08b", label: "Replay T08B" },
];

const MEMBERS = [
  { id: "DEMO-M001", label: "Harry Whitfield" },
  { id: "DEMO-M002", label: "Mina Chen" },
  { id: "DEMO-M003", label: "Owen Brooks" },
  { id: "DEMO-M004", label: "Priya Nair" },
  { id: "DEMO-M005", label: "Luis Ortega" },
];

const NEED_PLAIN: Record<string, string> = {
  opening: "Listening",
  listening: "Listening",
  refill_status: "Refill status",
  "refill status": "Refill status",
  historical_price: "Past charges",
  prospective_comparison: "Price comparison",
  service_education: "Delivery service",
  service_election: "Enrollment choice",
  coverage_status: "Coverage case",
  unrecognized_request: "Unrecognized request",
  unsupported_work: "Not available here",
};

const STEP_PLAIN: Record<string, string> = {
  "verify greeting → await identity": "Verify greeting, then identity",
  "greeting verified · await identity": "Greeting done — verify identity",
  "identity verified · refill workflow": "Identity verified — refill",
  listening: "Listening",
};

const OBLIGATION_PLAIN: Record<
  ObligationStatus,
  { label: string; sym: string; kind: string }
> = {
  not_applicable: { label: "Not needed yet", sym: "–", kind: "idle" },
  pending_later: { label: "Not needed yet", sym: "–", kind: "idle" },
  due_now: { label: "Due now", sym: "!", kind: "due" },
  exact_timely: { label: "Said", sym: "✓", kind: "said" },
  paraphrased: { label: "Wording differs", sym: "≠", kind: "late" },
  late_finding: { label: "Said late", sym: "⚠", kind: "late" },
  unable_to_verify: { label: "Could not verify", sym: "?", kind: "verify" },
};

function hideDemoIds(text: string) {
  return text.replace(/\bDEMO-[A-Z0-9-]+\b/g, "").replace(/\s{2,}/g, " ").trim();
}

function needStepLabel(session: SessionState) {
  const need = session.currentNeed?.trim() || "listening";
  if (need === "listening" || need === "opening") return "Listening";
  return `${plainNeed(need)} · ${plainStep(session.flowStep)}`;
}

function Highlighted(props: { text: string; highlight?: string }) {
  const h = props.highlight?.trim();
  if (!h) return props.text;
  const i = props.text.toLowerCase().indexOf(h.toLowerCase());
  if (i < 0) return props.text;
  return (
    <>
      {props.text.slice(0, i)}
      <mark>{props.text.slice(i, i + h.length)}</mark>
      {props.text.slice(i + h.length)}
    </>
  );
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

function plainNeed(value: string) {
  return NEED_PLAIN[value] ?? value.replace(/_/g, " ");
}

function plainStep(value: string) {
  if (STEP_PLAIN[value]) return STEP_PLAIN[value];
  return value.replace(/→/g, ",").replace(/·/g, " — ").replace(/_/g, " ");
}

function shortSource(label: string | undefined) {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes("pharmacy")) return "Pharmacy system";
  if (l.includes("claims")) return "Claims system";
  if (l.includes("eligibility")) return "Eligibility system";
  if (l.includes("provider")) return "Pharmacy directory";
  if (l.includes("telephony")) return "Phone menu";
  if (l.includes("coverage")) return "Coverage review";
  if (l.includes("playbook")) return "Playbook";
  if (l.includes("benefits") || l.includes("scripting") || l.includes("governed")) {
    return "Plan rules";
  }
  return "Plan rules";
}

function speakerLabel(
  speaker: string,
  memberVisible: boolean,
  memberName: string | null,
) {
  if (speaker === "advocate") return "You";
  if (speaker === "member") {
    return memberVisible && memberName ? memberName : "Caller";
  }
  return speaker;
}

function compactTranscript(lines: TranscriptLine[]): TranscriptLine[] {
  const slots = new Map<string, TranscriptLine>();
  const order: string[] = [];
  const alias = new Map<string, string>();
  const resolve = (id: string) => {
    let cur = id;
    while (alias.has(cur)) cur = alias.get(cur)!;
    return cur;
  };
  for (const line of lines) {
    if (line.correctsEventId) {
      const target = resolve(line.correctsEventId);
      if (slots.has(target)) {
        slots.set(target, { ...line, id: target });
        alias.set(line.id, target);
        continue;
      }
    }
    if (line.stability === "partial" || line.stability === "final") {
      const lastPartial = [...order].reverse().find((id) => {
        const existing = slots.get(id);
        return (
          existing &&
          existing.speaker === line.speaker &&
          existing.stability === "partial"
        );
      });
      if (lastPartial) {
        slots.set(lastPartial, { ...line, id: lastPartial });
        alias.set(line.id, lastPartial);
        continue;
      }
    }
    slots.set(line.id, line);
    order.push(line.id);
  }
  return order.map((id) => slots.get(id)!);
}

function ObligationChip(props: {
  name: string;
  status: ObligationStatus | undefined;
  exact: string | undefined;
  note?: string;
  demo: boolean;
}) {
  const meta = props.status
    ? OBLIGATION_PLAIN[props.status]
    : OBLIGATION_PLAIN.not_applicable;
  return (
    <details className={`chip ${meta.kind}`}>
      <summary>
        <span className="sym" aria-hidden="true">
          {meta.sym}
        </span>
        <span>
          {props.name}: {meta.label}
        </span>
      </summary>
      {props.exact && <p>{props.exact}</p>}
      {props.demo && props.note && <p className="source">{props.note}</p>}
    </details>
  );
}

export default function Page() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclosureNetwork, setDisclosureNetwork] = useState<string>("");
  const [enrollToken, setEnrollToken] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioKind>("t01_m2a");
  const [memberId, setMemberId] = useState("DEMO-M001");
  const [members, setMembers] = useState(MEMBERS);
  const [demoDetails, setDemoDetails] = useState(false);
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

  async function startCall(kind: ScenarioKind, selectedMemberId: string) {
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
          memberId: selectedMemberId,
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

  useEffect(() => {
    void fetch("/api/simulated/eligibility/members")
      .then((r) => r.json())
      .then((json: { data?: Array<{ memberId: string; given: string; family: string }> }) => {
        const rows = json.data ?? [];
        if (!rows.length) return;
        setMembers(
          rows.map((m) => ({
            id: m.memberId,
            label: `${m.given} ${m.family}`,
          })),
        );
      })
      .catch(() => {
        /* keep fixture list */
      });
  }, []);

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
  const memberName = session?.member
    ? `${session.member.name.given} ${session.member.name.family}`
    : null;
  const lastRouter =
    session?.diagnostics.router[session.diagnostics.router.length - 1];
  const rejectedWrongPlan = session?.diagnostics.router
    .flatMap((r) => r.rejected)
    .filter((x) => x.reason === "rejected: wrong plan");

  const advocateNow = Boolean(session) && !memberVisible && !demoDetails;
  const nowTitle = advocateNow
    ? "Verify the caller's identity"
    : (session?.nowCard.title ?? "Opening");
  const rawBody =
    session?.nowCard.body ?? "Start the call to load the workspace.";
  const nowBody = advocateNow
    ? null
    : demoDetails
      ? rawBody
      : hideDemoIds(rawBody);
  const phoneHint =
    advocateNow && session?.ivrReason
      ? `Phone menu hinted a ${session.ivrReason}.`
      : null;
  const nowSource = session?.nowCard.sourceLabel;
  const displayLines = compactTranscript(session?.transcript ?? []);

  return (
    <main className={session?.paused ? "workspace paused" : "workspace"}>
      <div className="demo-bar">
        <label>
          Scenario
          <select
            value={scenario}
            disabled={Boolean(session) || busy}
            onChange={(e) => setScenario(e.target.value as ScenarioKind)}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Member (presenter)
          <select
            value={memberId}
            disabled={Boolean(session) || busy}
            onChange={(e) => setMemberId(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {!session && (
          <button disabled={busy} onClick={() => startCall(scenario, memberId)}>
            Start
          </button>
        )}
        {session?.paused && (
          <button className="secondary" onClick={resume}>
            Resume
          </button>
        )}
        <span className="sim-badge">
          {demoDetails ? (
            <>
              <span className="sym" aria-hidden="true">
                ⌬
              </span>
              Simulated data
            </>
          ) : null}
        </span>
        <label>
          <input
            type="checkbox"
            checked={demoDetails}
            onChange={(e) => setDemoDetails(e.target.checked)}
          />
          Show demo details
        </label>
        {session?.paused && demoDetails && (
          <span className="pause-notice">
            <span className="mark">Paused</span>
            {session.lastPauseLabel ??
              "Presenter-gated pause — excluded from machine response time."}
          </span>
        )}
      </div>

      <header className="strip">
        <dl>
          <div>
            <dt>Caller</dt>
            <dd>
              {memberVisible
                ? `${memberName}${session?.member?.lineOfBusiness ? ` · ${session.member.lineOfBusiness}` : ""}`
                : "Not verified"}
            </dd>
          </div>
          {memberVisible && session?.member && demoDetails && (
            <div>
              <dt>Plan</dt>
              <dd>{session.member.planId}</dd>
            </div>
          )}
          <div>
            <dt>Call type</dt>
            <dd>{session?.callType ?? "—"}</dd>
          </div>
          <div>
            <dt>Need / step</dt>
            <dd>{session ? needStepLabel(session) : "Not started"}</dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd>{session ? formatElapsed(session.elapsedMs) : "0:00"}</dd>
          </div>
          {demoDetails && session?.auth && (
            <div>
              <dt>Authorization</dt>
              <dd>
                {session.auth.authorizationId} · {session.auth.role} ·{" "}
                {session.identityStatus}
              </dd>
            </div>
          )}
        </dl>
      </header>

      <div className="chips">
        <ObligationChip
          name="Recorded-line greeting"
          status={session?.greeting}
          exact={greetingReq?.verbatimText}
          note={demoDetails ? greetingReq?.requirementId : undefined}
          demo={demoDetails}
        />
        <ObligationChip
          name="Pricing disclaimer"
          status={session?.pricing}
          exact={pricingReq?.verbatimText}
          note={
            demoDetails
              ? "Historical charges do not trigger this statement."
              : undefined
          }
          demo={demoDetails}
        />
        <ObligationChip
          name="Closing statement"
          status={session?.closing}
          exact={closingReq?.verbatimText}
          note={
            demoDetails
              ? session?.closingNote ??
                "Clicking Offer does not create this obligation."
              : undefined
          }
          demo={demoDetails}
        />
      </div>

      <section className="now">
        <h2>Now</h2>
        {session?.nudge && (
          <div className="nudge">
            <strong>{session.nudge.template}</strong>
            {session.nudge.requiredText && <p>{session.nudge.requiredText}</p>}
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
        <h3 className="now-title">{nowTitle}</h3>
        {phoneHint && <p className="now-secondary">{phoneHint}</p>}
        {demoDetails && (session?.nowCard.liveSteps?.length ?? 0) > 0 && (
          <ol className="live-steps">
            {session!.nowCard.liveSteps!.map((step, i) => (
              <li key={`${step}-${i}`}>{step}</li>
            ))}
          </ol>
        )}
        {(session?.nowCard.earlyFacts?.length ?? 0) > 0 && (
          <div className="early-facts">
            <h4 className="subhead">Facts</h4>
            <ul>
              {session!.nowCard.earlyFacts!.map((f, i) => (
                <li key={`${f.text}-${i}`}>
                  {demoDetails ? f.text : hideDemoIds(f.text)}
                  <button
                    className="source-tag"
                    type="button"
                    onClick={() =>
                      human("/api/session/human/view-evidence", {
                        sourceId: f.source,
                      })
                    }
                  >
                    {shortSource(f.source) ?? f.source}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(session?.nowCard.statements?.length ?? 0) > 0 ? (
          <div className="statements">
            {session!.nowCard.statements!.map((st, i) => (
              <p key={`${st.text}-${i}`}>
                {demoDetails ? st.text : hideDemoIds(st.text)}{" "}
                <button
                  className="source-tag"
                  type="button"
                  onClick={() =>
                    human("/api/session/human/view-evidence", {
                      sourceId: st.sourceId,
                    })
                  }
                >
                  {st.confirmed ? st.sourceTag : "Not confirmed"}
                </button>
              </p>
            ))}
          </div>
        ) : (
          nowBody && <p>{nowBody}</p>
        )}
        {nowSource &&
          (demoDetails ? (
            <p className="source">{nowSource}</p>
          ) : (
            !advocateNow &&
            session?.pricing !== "due_now" &&
            session?.closing !== "due_now" &&
            shortSource(nowSource) && (
              <span className="source-tag">{shortSource(nowSource)}</span>
            )
          ))}
        {session && (
          <div className="actions">
            <button
              className="linkish"
              type="button"
              onClick={() => human("/api/session/human/view-evidence")}
            >
              View evidence
            </button>
            <button
              className="linkish"
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
            <p>
              <Highlighted
                text={session.openEvidence.body}
                highlight={session.openEvidence.highlight}
              />
            </p>
            {demoDetails && (
              <p className="source">{session.openEvidence.sourceLabel}</p>
            )}
          </div>
        )}
        {session?.recommendation?.status === "pending" && (
          <div className="actions">
            {(session.recommendation.advocateControl ?? "offer_dismiss") ===
              "offer_dismiss" &&
              session.recommendation.kind !== "warm_transfer" && (
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
            {(session.recommendation.advocateControl === "confirm_transfer" ||
              session.recommendation.kind === "warm_transfer") && (
              <button
                type="button"
                onClick={() => human("/api/session/human/confirm-transfer")}
              >
                Confirm Coverage Review destination
              </button>
            )}
            <p>
              {demoDetails
                ? session.recommendation.body
                : hideDemoIds(session.recommendation.body)}
            </p>
            {session.recommendation.reasons?.length ? (
              <ul>
                {session.recommendation.reasons.map((r, i) => (
                  <li key={r}>
                    {demoDetails ? r : hideDemoIds(r)}
                    {session.recommendation?.facts?.[i] ? (
                      <button
                        className="source-tag"
                        type="button"
                        onClick={() =>
                          human("/api/session/human/view-evidence", {
                            sourceId: session.recommendation?.playbookIds?.[0],
                          })
                        }
                      >
                        Record
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {session.recommendation.playbookPassage && (
              <button
                className="source-tag"
                type="button"
                onClick={() =>
                  human("/api/session/human/view-evidence", {
                    sourceId: session.recommendation?.playbookIds?.[0],
                  })
                }
              >
                Playbook
              </button>
            )}
          </div>
        )}
        {session &&
          session.quotes.length > 0 &&
          quoteAmountsMayRender(session.consent.comparison) &&
          session.pricingExactDelivered &&
          session.pricing !== "due_now" &&
          session.pricing !== "late_finding" &&
          session.pricing !== "paraphrased" && (
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
            <p>{session.enrollment.readback}</p>
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
                disabled={
                  !enrollToken ||
                  !session.enrollment.confirmed ||
                  session.enrollment.withdrawn
                }
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
                {demoDetails ? `Returned ${session.enrollment.resultId} scope ` : "Returned scope "}
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
            {demoDetails ? `${session.coverage.caseId}: ` : ""}
            {session.coverage.requestedMedication} · {session.coverage.status} ·
            determination {session.coverage.determination ?? "null"}
          </p>
        )}
        {session?.handoffDraft && (
          <div>
            <h3 className="subhead">Handoff draft</h3>
            {session.handoffLines?.length ? (
              session.handoffLines.map((ln, i) => (
                <p key={i}>
                  {demoDetails ? ln.text : hideDemoIds(ln.text)}{" "}
                  <button
                    className="source-tag"
                    type="button"
                    onClick={() =>
                      human("/api/session/human/view-evidence", {
                        sourceId: ln.sourceId,
                      })
                    }
                  >
                    {ln.sourceTag}
                  </button>
                </p>
              ))
            ) : (
              <p>
                {demoDetails
                  ? session.handoffDraft
                  : hideDemoIds(session.handoffDraft)}
              </p>
            )}
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
            {demoDetails && session.transfer.transferId
              ? `${session.transfer.transferId}: `
              : ""}
            {session.transfer.connectionStatus}. Coverage case{" "}
            {demoDetails ? session.coverage?.caseId : ""} remains{" "}
            {session.coverage?.status ?? "unreturned"}.
          </p>
        )}
        {session?.wrapDraft && (
          <div>
            <h3 className="subhead">Wrap (editable)</h3>
            {session.wrapLines?.length ? (
              <div>
                {session.wrapLines.map((ln, i) => (
                  <p key={i}>
                    {demoDetails ? ln.text : hideDemoIds(ln.text)}{" "}
                    <button
                      className="source-tag"
                      type="button"
                      onClick={() =>
                        human("/api/session/human/view-evidence", {
                          sourceId: ln.sourceId,
                        })
                      }
                    >
                      {ln.sourceTag}
                    </button>
                  </p>
                ))}
              </div>
            ) : null}
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
        {session?.outcomeReady && demoDetails && (
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
            {demoDetails && (
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
            )}
          </div>
        )}
        {error && <p>{error}</p>}
      </section>

      <aside className="drawer">
        <h2>Context</h2>
        {!memberVisible && (
          <p>Member details appear after the caller is verified.</p>
        )}
        {memberVisible && session?.member && (
          <p>
            {session.member.name.given} {session.member.name.family}
            {session.member.lineOfBusiness
              ? ` · ${session.member.lineOfBusiness}`
              : ""}
            {demoDetails ? (
              <>
                <br />
                Plan {session.member.planId}
              </>
            ) : null}
          </p>
        )}
        {demoDetails && (
          <p className="source">
            {memberVisible
              ? "System record · eligibility · simulated"
              : "System record · telephony · simulated"}
          </p>
        )}
        <h3 className="subhead">Open needs</h3>
        {(session?.needs ?? []).length === 0 &&
          !session?.consent.clarification && <p>None yet.</p>}
        {session?.consent.clarification && (
          <div className="need">
            <div className="need-head">
              <strong>Clarify comparison interest</strong>
              <span className="mark">open</span>
            </div>
            <p className="source">{session.consent.clarification}</p>
          </div>
        )}
        {(session?.needs ?? []).map((need) => (
          <div key={need.kind} className="need">
            <div className="need-head">
              <strong>{plainNeed(need.kind)}</strong>
              <span className="mark">{need.status.replace(/_/g, " ")}</span>
              {need.guidance === "deferred_valid" && (
                <span className="mark">Answer ready</span>
              )}
              {need.guidance === "ready" && (
                <span className="mark">ready</span>
              )}
            </div>
            <p className="source">{plainStep(need.flowStep)}</p>
            {need.answer && (
              <p>
                {demoDetails
                  ? need.answer.body
                  : hideDemoIds(need.answer.body)}
              </p>
            )}
            <button
              className="secondary"
              type="button"
              onClick={() => selectFocus(need.kind)}
            >
              Make this the focus
            </button>
          </div>
        ))}
        {session && session.quotes.length > 0 && (
          <div className="need">
            <div className="need-head">
              <strong>Prospective comparison</strong>
              <span className="mark">
                {session.pricing === "due_now" ||
                session.pricing === "late_finding" ||
                session.pricing === "paraphrased"
                  ? "ready, demoted"
                  : "ready"}
              </span>
            </div>
            {quoteAmountsMayRender(session.consent.comparison) ? (
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
            ) : (
              <p className="source">
                Quotes are on file. Amounts stay hidden until comparison
                interest is an absolute yes.
              </p>
            )}
          </div>
        )}
        {demoDetails && (
          <details className="diagnostics" open>
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
              rejected wrong-plan: {JSON.stringify(rejectedWrongPlan)}
              {"\n"}
              last routes: {JSON.stringify(lastRouter, null, 2)}
              {"\n"}
              triggers: {JSON.stringify(session?.diagnostics.triggers, null, 2)}
              {"\n"}
              rechecks: {JSON.stringify(session?.diagnostics.rechecks)}
              {"\n"}
              interpretation:{" "}
              {JSON.stringify(session?.lastInterpretation, null, 2)}
              {"\n"}
              timings: {JSON.stringify(session?.lastTimings, null, 2)}
            </pre>
          </details>
        )}
      </aside>

      <section className="transcript">
        <h2>Transcript</h2>
        {displayLines.map((line) => (
          <p key={line.id} className="line">
            {line.stability === "uncertain" && (
              <span className="mark mark-uncertain">? Uncertain</span>
            )}
            {line.stability === "corrected" && (
              <span className="mark">✎ Corrected</span>
            )}
            <span className="mark">
              {speakerLabel(line.speaker, memberVisible, memberName)}
            </span>
            {line.text}
          </p>
        ))}
        {demoDetails && (
          <details className="diagnostics">
            <summary>Full transcript events</summary>
            {(session?.transcript ?? []).map((line) => (
              <p key={`full-${line.id}`} className="line">
                <span
                  className={
                    line.stability === "uncertain"
                      ? "mark mark-uncertain"
                      : "mark"
                  }
                >
                  {line.stability === "uncertain" ? "UNCERTAIN" : line.stability}
                </span>
                <span className="mark">{line.speaker}</span>
                <span className="mark">{line.id}</span>
                {line.text}
                {line.correctsEventId ? ` (corrects ${line.correctsEventId})` : ""}
              </p>
            ))}
          </details>
        )}
      </section>
    </main>
  );
}
