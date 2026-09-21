"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NeedKind,
  SessionState,
} from "@/lib/types";
import { AdvocateScreen } from "./AdvocateScreen";

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
  inputSource?: "stream" | "presenter_typed" | "presenter_picked";
};

type PresenterQuestion = {
  topic: string;
  question: string;
};

type ScenarioKind =
  | "open_call"
  | "t01_m2a"
  | "t02a"
  | "t03a"
  | "t03b"
  | "t04b"
  | "t06a"
  | "t08b";

const SCENARIO_OVERLAY: Record<ScenarioKind, string | null> = {
  open_call: null,
  t01_m2a: null,
  t02a: null,
  t03a: null,
  t03b: null,
  t04b: "T04B",
  t06a: "T06A",
  t08b: "T08B",
};

const SCENARIOS: { id: ScenarioKind; label: string }[] = [
  { id: "open_call", label: "Open call" },
  { id: "t01_m2a", label: "Harry Whitfield — Main call" },
  { id: "t02a", label: "Harry Whitfield — Clean servicing" },
  { id: "t03a", label: "Harry Whitfield — 90-day inquiry" },
  { id: "t03b", label: "Harry Whitfield — Firm refusal" },
  { id: "t04b", label: "Harry Whitfield — Pharmacy correction" },
  { id: "t06a", label: "Harry Whitfield — Missing evidence" },
  { id: "t08b", label: "Harry Whitfield — Enrollment withdrawal" },
];

const SCRIPT_MEMBER: Record<ScenarioKind, string | null> = {
  open_call: null,
  t01_m2a: "DEMO-M001",
  t02a: "DEMO-M001",
  t03a: "DEMO-M001",
  t03b: "DEMO-M001",
  t04b: "DEMO-M001",
  t06a: "DEMO-M001",
  t08b: "DEMO-M001",
};

const MEMBERS = [
  { id: "DEMO-M001", label: "Harry Whitfield" },
  { id: "DEMO-M002", label: "Mina Chen" },
  { id: "DEMO-M003", label: "Owen Brooks" },
  { id: "DEMO-M004", label: "Priya Nair" },
  { id: "DEMO-M005", label: "Luis Ortega" },
];

/** UI playback only. Does not change logged offsetMs or 1/2/5/8 clocks. */
const PLAYBACK_STRETCH = 2.5;

const SAY_DWELL_MS = 3500;

/**
 * Pace playback to the Now card, matching the T01 transcript race:
 * hold while the lookup that owns Now is open (and ~3.5s after its say);
 * do not hold for a background lookup while a prior answer still owns Now
 * (Harry interrupts metformin before that answer returns).
 */
function streamHold(session: SessionState | null) {
  if (!session) return false;
  const body = (session.nowCard.body ?? "").trim();
  const sayReady = session.nowCardOrigin === "answer" && Boolean(body);
  const open = [...(session.lookupProgress ?? [])]
    .reverse()
    .find((p) => p.answeredAt == null);
  if (open) {
    if (Date.now() >= open.startedAt + 8000) return false;
    const openNeed =
      session.needs.find((n) => n.sourceUtteranceId === open.sourceUtteranceId)
        ?.kind ?? session.answerLoopAnchor?.needKind;
    // Background / interrupted lookup: prior answer still owns Now — let the
    // next scripted line through (e-interrupt while e-hist Terra is in flight).
    const lookupOwnsNow =
      !sayReady ||
      (openNeed != null && session.nowCardNeedKind === openNeed);
    if (!lookupOwnsNow) return false;
    return true;
  }
  if (session.activeInterpretations > 0 && !sayReady) {
    const lastMember = [...session.transcript]
      .reverse()
      .find(
        (t) =>
          t.speaker === "member" &&
          (t.stability === "final" || t.stability === "corrected"),
      );
    if (lastMember) {
      const answered = session.needs.some(
        (n) =>
          (n.sourceUtteranceId === lastMember.id ||
            n.queryText === lastMember.text) &&
          Boolean(n.answer?.body),
      );
      if (!answered) return true;
    }
  }
  const shown = [...(session.lookupProgress ?? [])]
    .reverse()
    .find((p) => p.answeredAt != null && !p.closedReason);
  if (sayReady && shown?.answeredAt != null && Date.now() - shown.answeredAt < SAY_DWELL_MS) {
    return true;
  }
  return false;
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
  const [stepMode, setStepMode] = useState(false);
  const [callerText, setCallerText] = useState("");
  const [advocateText, setAdvocateText] = useState("");
  const [questions, setQuestions] = useState<PresenterQuestion[]>([]);
  const [pickedQuestion, setPickedQuestion] = useState("");
  const [presenterNotice, setPresenterNotice] = useState("");
  const [dispositionChoice, setDispositionChoice] = useState("");
  const [userPaused, setUserPaused] = useState(false);
  const userPausedRef = useRef(false);
  const endedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<SessionState | null>(null);
  const stepModeRef = useRef(false);
  const playGenRef = useRef(0);
  sessionRef.current = session;
  stepModeRef.current = stepMode;

  const pullSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) return;
    try {
      const resp = await fetch(`/api/session/state?sessionId=${sessionId}`, {
        cache: "no-store",
      });
      const json = (await resp.json()) as { session?: SessionState };
      if (json.session) {
        setSession(json.session);
        sessionRef.current = json.session;
        endedRef.current = json.session.callEnd.ended;
      }
    } catch {
      /* keep last painted state */
    }
  }, []);

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
    const json = (await resp.json()) as {
      session?: SessionState;
      error?: string;
    };
    if (!resp.ok) {
      setError(json.error ?? `Input failed (${resp.status})`);
      return false;
    }
    if (json.session) {
      setSession(json.session);
      sessionRef.current = json.session;
      endedRef.current = json.session.callEnd.ended;
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 50);
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
    if (painted.session) {
      setSession(painted.session);
      sessionRef.current = painted.session;
    }
    return true;
  }, []);

  const playEvents = useCallback(
    async (events: StreamEvent[], gen: number) => {
      let last = 0;
      for (const ev of events) {
        if (endedRef.current || playGenRef.current !== gen) break;
        const gap = Math.max(0, ev.offsetMs - last);
        last = ev.offsetMs;
        const wait = Math.round(gap * PLAYBACK_STRETCH);
        let remaining = wait;
        while (remaining > 0) {
          if (endedRef.current || playGenRef.current !== gen) return;
          if (userPausedRef.current) {
          await new Promise((r) => setTimeout(r, 100));
            continue;
          }
          const slice = Math.min(120, remaining);
          const t0 = Date.now();
          await new Promise((r) => setTimeout(r, slice));
          remaining -= Date.now() - t0;
        }
        while (userPausedRef.current) {
          await new Promise((r) => setTimeout(r, 100));
          if (endedRef.current || playGenRef.current !== gen) return;
        }
        if (ev.type === "transcript") {
          while (
            streamHold(sessionRef.current) &&
            !endedRef.current &&
            playGenRef.current === gen
          ) {
            await pullSession(sessionIdRef.current);
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        if (ev.type === "pause_gate") {
          if (stepModeRef.current) {
            userPausedRef.current = true;
            setUserPaused(true);
            await ingest(ev);
            while (userPausedRef.current && !endedRef.current) {
              await new Promise((r) => setTimeout(r, 100));
            }
          }
          continue;
        }
        await ingest(ev);
      }
    },
    [ingest, pullSession],
  );

  async function startCall(kind: ScenarioKind, selectedMemberId: string) {
    playGenRef.current += 1;
    setBusy(true);
    setError(null);
    try {
      const start = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: kind,
          overlay: SCENARIO_OVERLAY[kind],
          injectedDelayMs: kind.startsWith("t01") ? 2800 : 0,
          memberId: SCRIPT_MEMBER[kind] ?? selectedMemberId,
        }),
      });
      const startJson = (await start.json()) as {
        session: SessionState;
        disclosureUrl?: string;
      };
      setDisclosureNetwork(
        `GET ${startJson.disclosureUrl ?? "/api/simulated/scripting/disclosures"} (session start)`,
      );
      sessionIdRef.current = startJson.session.sessionId;
      setSession(startJson.session);
      setEnrollToken(null);
      userPausedRef.current = false;
      setUserPaused(false);
      endedRef.current = false;
      playGenRef.current += 1;
      const gen = playGenRef.current;
      const stream = await fetch(
        `/api/simulated/telephony/scenario-events?id=${kind}`,
        { cache: "no-store" },
      );
      const streamJson = (await stream.json()) as {
        data?: { events?: StreamEvent[] };
      };
      playEvents(streamJson.data?.events ?? [], gen);
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
    userPausedRef.current = false;
    setUserPaused(false);
  }

  async function sendPresenterLine(
    speaker: "member" | "advocate",
    text: string,
    inputSource: "presenter_typed" | "presenter_picked",
  ) {
    if (!session || !text.trim() || session.callEnd.ended) return;
    userPausedRef.current = true;
    setUserPaused(true);
    setError(null);
    const originalLength = text.length;
    const ok = await ingest({
      id: `presenter-${crypto.randomUUID()}`,
      offsetMs: session.elapsedMs,
      type: "transcript",
      speaker,
      stability: "final",
      text,
      inputSource,
    });
    if (!ok) {
      userPausedRef.current = false;
      setUserPaused(false);
      return;
    }
    const max = session.presenterInput.maxLength;
    setPresenterNotice(
      originalLength > max
        ? `Input cut from ${originalLength} to ${max} characters; the cut text is shown in the transcript.`
        : `${speaker === "member" ? "Caller" : "Advocate"} line sent; scripted stream paused.`,
    );
    if (speaker === "member") setCallerText("");
    else setAdvocateText("");
  }

  async function endCall() {
    if (!session || session.callEnd.ended) return;
    userPausedRef.current = true;
    setUserPaused(true);
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/session/end-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      const json = (await resp.json()) as {
        session?: SessionState;
        error?: string;
      };
      if (!resp.ok || !json.session) {
        setError(json.error ?? `End call failed (${resp.status})`);
        userPausedRef.current = false;
        setUserPaused(false);
        return;
      }
      setSession(json.session);
      endedRef.current = true;
      userPausedRef.current = true;
      setUserPaused(true);
    } finally {
      setBusy(false);
    }
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
      error?: string;
    };
    if (!resp.ok) setError(json.error ?? `Action failed (${resp.status})`);
    if (json.token) setEnrollToken(json.token);
    if (json.session) {
      setSession(json.session);
      sessionRef.current = json.session;
    }
  }

  async function togglePause() {
    if (!session || session.callEnd.ended) return;
    if (userPausedRef.current) {
      await resume();
      return;
    }
    userPausedRef.current = true;
    setUserPaused(true);
    await ingest({
      id: `presenter-pause-${crypto.randomUUID()}`,
      offsetMs: session.elapsedMs,
      type: "pause_gate",
      pauseLabel: "Presenter pause",
    });
  }

  async function submitEnrollment() {
    if (!session) return;
    const mint = await fetch("/api/session/human/mint-enrollment-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        scope: { medications: session.enrollment.medications },
      }),
    });
    const minted = (await mint.json()) as {
      session?: SessionState;
      token?: string;
      error?: string;
    };
    if (!mint.ok) {
      setError(minted.error ?? "Could not confirm enrollment");
      if (minted.session) setSession(minted.session);
      return;
    }
    const token = minted.token ?? enrollToken;
    if (minted.session) setSession(minted.session);
    if (minted.token) setEnrollToken(minted.token);
    if (!token) return;
    const submit = await fetch("/api/session/human/submit-enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, token }),
    });
    const submitted = (await submit.json()) as {
      session?: SessionState;
      error?: string;
    };
    if (!submit.ok) setError(submitted.error ?? "Submit failed");
    if (submitted.session) {
      setSession(submitted.session);
      sessionRef.current = submitted.session;
    }
  }

  function finishReview() {
    setSession(null);
    sessionIdRef.current = null;
    userPausedRef.current = false;
    setUserPaused(false);
    endedRef.current = false;
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
          sessionRef.current = json.session;
          endedRef.current = json.session.callEnd.ended;
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    const poll = setInterval(() => {
      void pullSession(sid);
    }, 400);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [session?.sessionId, pullSession]);

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

  useEffect(() => {
    void fetch("/api/simulated/scripting/presenter-questions")
      .then((response) => response.json())
      .then(
        (json: { data?: { questions?: PresenterQuestion[] } }) => {
          setQuestions(json.data?.questions ?? []);
        },
      )
      .catch(() => setQuestions([]));
  }, []);

  useEffect(() => {
    if (session?.disposition.recommended) {
      setDispositionChoice(session.disposition.recommended);
    }
  }, [session?.disposition.recommended]);

  const scriptMemberId = SCRIPT_MEMBER[scenario];
  const scriptMemberLabel = scriptMemberId
    ? (members.find((m) => m.id === scriptMemberId)?.label ?? scriptMemberId)
    : null;

  return (
    <AdvocateScreen
      session={session}
      busy={busy}
      error={error}
      demoDetails={demoDetails}
      setDemoDetails={setDemoDetails}
      scenario={scenario}
      setScenario={(next) => {
              setScenario(next);
              const lock = SCRIPT_MEMBER[next];
              if (lock) setMemberId(lock);
            }}
      memberId={memberId}
      setMemberId={setMemberId}
      members={members}
      questions={questions}
      callerText={callerText}
      setCallerText={setCallerText}
      advocateText={advocateText}
      setAdvocateText={setAdvocateText}
      pickedQuestion={pickedQuestion}
      setPickedQuestion={setPickedQuestion}
      presenterNotice={presenterNotice}
      dispositionChoice={dispositionChoice}
      setDispositionChoice={setDispositionChoice}
      stepMode={stepMode}
      setStepMode={setStepMode}
      scriptMemberId={scriptMemberId}
      scriptMemberLabel={scriptMemberLabel}
      startCall={startCall}
      userPaused={userPaused}
      togglePause={() => void togglePause()}
      sendPresenterLine={sendPresenterLine}
      endCall={() => void endCall()}
      human={human}
      selectFocus={selectFocus}
      disclosureNetwork={disclosureNetwork}
      finishReview={finishReview}
      submitEnrollment={submitEnrollment}
    />
  );
}
