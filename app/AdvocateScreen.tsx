"use client";

import { useEffect, useRef, useState } from "react";
import {
  clarificationHoldsNow,
  requiredPricingOnNow,
  requiredWordingOnNow,
} from "@/lib/nowOccupancy";
import { quoteAmountsMayRender } from "@/lib/utteranceRules";
import { advocateFacing, usedKnowledgeSources } from "@/lib/citations";
import {
  fromAnswerSources,
  humanaKindForCard,
  HUMANA_KIND,
  kindFromPlaybook,
} from "@/lib/cardKindLabel";
import { needHasRealAnswer, parkedNeedKindForUtterance } from "@/lib/parkedNeed";
import { QualityScoreLine } from "@/app/QualityScoreLine";
import { alignedWordDiff, type WordMark } from "@/lib/exactness";
import type {
  NeedKind,
  ObligationStatus,
  SessionState,
  TranscriptLine,
} from "@/lib/types";

function renderMarkedWords(marks: WordMark[], hideIds: (s: string) => string) {
  return marks.map((m, i) => (
    <span key={`${m.word}-${i}`}>
      {i > 0 ? " " : null}
      {m.status === "same" ? (
        hideIds(m.word)
      ) : (
        <mark className={m.status === "missing" ? "diff-missing" : "diff-extra"}>
          {hideIds(m.word)}
        </mark>
      )}
    </span>
  ));
}

type ScenarioKind =
  | "open_call"
  | "t01_m2a"
  | "t02a"
  | "t03a"
  | "t03b"
  | "t04b"
  | "t06a"
  | "t08b";

type PresenterQuestion = { topic: string; question: string };

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

const THUMB_REASONS = [
  "Wrong fact",
  "Not relevant",
  "Bad timing",
  "Too long",
  "Unclear",
  "Other",
];

function hideDemoIds(text: string) {
  return text
    .replace(/\bDEMO-[A-Z0-9-]+\b/g, "")
    .replace(/\bpreferred_retail\b/gi, "preferred pharmacy")
    .replace(/\bstandard_retail\b/gi, "standard pharmacy")
    .replace(/\bREADY_FOR_PICKUP\b/g, "ready for pickup")
    .replace(/\bPENDING_REVIEW\b/g, "pending review")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

/** Browser-local wall clock, hh:mm:ss. */
function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

function sourceLabel(raw: string | undefined, bts: boolean) {
  if (!raw) return "This call";
  const l = raw.toLowerCase();
  let plain = "This call";
  if (l.includes("claim")) plain = "His claims";
  else if (l.includes("plan") || l.includes("policy") || l.includes("cost-share") || l.includes("classification") || l.includes("benefit"))
    plain = "His plan's rules";
  else if (l.includes("provider") || l.includes("directory")) plain = "Pharmacy list";
  else if (l.includes("playbook") || l.includes("script") || l.includes("governed") || l.includes("guidance"))
    plain = "Humana's guidance";
  else if (l.includes("enroll")) plain = "Enrollment result";
  else if (l.includes("coverage")) plain = "Coverage case";
  else if (l.includes("pharmacy") || l.includes("refill") || l.includes("prescription"))
    plain = "Pharmacy system";
  else if (l.includes("telephony") || l.includes("phone")) plain = "This call";
  if (bts) return `${plain} · ${raw}`;
  return plain;
}

function obligationChip(
  plainName: string | undefined,
  fallback: string,
  status: ObligationStatus | undefined,
) {
  const name = plainName || fallback;
  if (!status || status === "not_applicable" || status === "pending_later") {
    return null;
  }
  if (status === "due_now") return { text: `! ${name} — read now`, kind: "due" };
  if (status === "exact_timely") return { text: `✓ ${name}`, kind: "said" };
  if (status === "late_finding") return { text: `! ${name} — said late`, kind: "late" };
  if (status === "paraphrased") return { text: `! ${name} — read now`, kind: "due" };
  if (status === "unable_to_verify") {
    return { text: `? ${name} — could not hear it clearly`, kind: "late" };
  }
  if (status === "missed_not_recoverable") {
    return { text: `! ${name} — missed`, kind: "late" };
  }
  return null;
}

/** After identity, greeting is no longer due — do not keep a “read now” chip. */
function greetingRailStatus(session: SessionState): ObligationStatus | undefined {
  const status = session.greeting;
  if (!status) return status;
  const identityOk =
    session.identityStatus === "VALID" || Boolean(session.auth);
  if (identityOk && (status === "due_now" || status === "paraphrased")) {
    return "late_finding";
  }
  return status;
}

function questionTitle(query?: string, fallback?: string) {
  let t = (query || fallback || "").trim().replace(/\s+/g, " ");
  // Interrupt preambles are not the question ("Actually first—can you check…").
  t = t.replace(
    /^(actually first|wait(?: a (?:sec|second|moment))?|oh(?: wait)?|also|one (?:sec|second)|hold on)\b[\s,.—–\-:]*/i,
    "",
  );
  if (!t) t = (fallback || query || "").trim().replace(/\s+/g, " ");
  if (!t) return "A question on this call";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function displayAnswerTitle(query?: string, title?: string) {
  const t = (title || "").trim();
  if (t && !/^(partial answer|answer|working on it)$/i.test(t)) return t;
  return questionTitle(query, title);
}

function suggestionFacts(rec: {
  facts?: string[];
  reasons?: string[];
}): string[] {
  const rows = (rec.facts?.length ? rec.facts : rec.reasons) ?? [];
  const prefer = rows.filter((row) =>
    /preferred|standard|pharmacy|mail|90-day|ninety/i.test(row),
  );
  const rest = rows.filter((row) => !prefer.includes(row));
  return [...prefer, ...rest].slice(0, 3);
}

function questionStatus(
  session: SessionState,
  kind: NeedKind,
  status: string,
  guidance: string,
  hasAnswer: boolean,
  nowShowsThisNeed: boolean,
): string {
  if (nowShowsThisNeed && !session.callEnd.ended) return "On screen";
  if (session.consent.comparison === "hedge" && kind === "prospective_comparison") {
    return "He is unsure";
  }
  if (hasAnswer || status === "resolved") return "Answered";
  if (status === "unresolved_gap" || guidance === "invalidated") return "Needs follow-up";
  if (guidance === "deferred_valid" || guidance === "ready") return "Waiting for you";
  return "Waiting for you";
}

function callerLines(session: SessionState, memberVisible: boolean) {
  if (!memberVisible) {
    return ["Details appear once the caller is verified."];
  }
  const name = session.member
    ? `${session.member.name.given} ${session.member.name.family}`
    : "Caller";
  const lob = session.member?.lineOfBusiness
    ? session.member.lineOfBusiness === "MAPD"
      ? "Medicare Advantage"
      : session.member.lineOfBusiness
    : "";
  const drugs = [
    ...new Set(
      (session.prefetch?.prescriptions ?? []).map((p) => p.drugName).filter(Boolean),
    ),
  ];
  const pickup =
    session.prefetch?.refill &&
    typeof session.prefetch.refill === "object" &&
    "pharmacyName" in session.prefetch.refill
      ? String((session.prefetch.refill as { pharmacyName?: string }).pharmacyName ?? "")
      : "";
  const lines = [`${name}${lob ? ` · ${lob}` : ""}`];
  if (drugs.length) lines.push(`Takes ${drugs.join(" and ")}`);
  if (pickup) lines.push(`Picks up at ${pickup}`);
  if (session.coverage?.requestedMedication) {
    lines.push(`Waiting on a ${session.coverage.requestedMedication} coverage review`);
  }
  return lines.slice(0, 5);
}

function Highlighted(props: { text: string; highlight?: string }) {
  const h = props.highlight?.trim();
  if (!h) return <>{props.text}</>;
  const i = props.text.toLowerCase().indexOf(h.toLowerCase());
  if (i < 0) return <>{props.text}</>;
  return (
    <>
      {props.text.slice(0, i)}
      <mark>{props.text.slice(i, i + h.length)}</mark>
      {props.text.slice(i + h.length)}
    </>
  );
}

function PillGlyph({ kind }: { kind: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
  } as const;
  if (kind === HUMANA_KIND.legal || kind === "legal") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v6c0 5 3.2 7.8 7 9 3.8-1.2 7-4 7-9V6l-7-3z" />
      </svg>
    );
  }
  if (kind === HUMANA_KIND.answer || kind === "answer") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5" />
        <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === HUMANA_KIND.tellCustomer || /tell customer/i.test(kind)) {
    return (
      <svg {...common}>
        <path d="M4 6.5h16v9H9l-5 3.5V6.5z" />
      </svg>
    );
  }
  if (kind === HUMANA_KIND.enrollment || kind === "enrollment") {
    return (
      <svg {...common}>
        <rect x="6" y="3" width="12" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    );
  }
  if (kind === HUMANA_KIND.transfer || kind === "transfer") {
    return (
      <svg {...common}>
        <path d="M8 5.5c4.5-2 9.5.4 10.2 5.2.2 1.4-.1 2.8-.8 4" />
        <path d="M15.5 16.5c-1.6 1.4-3.8 2-5.9 1.5-3.2-.8-5.4-3.8-5.4-7.1" />
        <path d="M8 3.5v4h4M16 20.5v-4h-4" />
      </svg>
    );
  }
  if (kind === HUMANA_KIND.disposition || kind === "wrap") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.5 2.4 2.4 4.6-5" />
      </svg>
    );
  }
  if (kind === HUMANA_KIND.objection || /object|rebut|reply/i.test(kind)) {
    return (
      <svg {...common}>
        <path d="M5 6h14v9H9l-4 3V6z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M9 21h6M12 3a5 5 0 0 1 5 5c0 2-1 3.5-2.5 4.5S12 15 12 17" />
    </svg>
  );
}

export type AdvocateScreenProps = {
  session: SessionState | null;
  busy: boolean;
  error: string | null;
  demoDetails: boolean;
  setDemoDetails: (v: boolean) => void;
  scenario: ScenarioKind;
  setScenario: (v: ScenarioKind) => void;
  memberId: string;
  setMemberId: (v: string) => void;
  members: { id: string; label: string }[];
  questions: PresenterQuestion[];
  callerText: string;
  setCallerText: (v: string) => void;
  advocateText: string;
  setAdvocateText: (v: string) => void;
  pickedQuestion: string;
  setPickedQuestion: (v: string) => void;
  presenterNotice: string;
  dispositionChoice: string;
  setDispositionChoice: (v: string) => void;
  stepMode: boolean;
  setStepMode: (v: boolean) => void;
  scriptMemberId: string | null;
  scriptMemberLabel: string | null;
  startCall: (kind: ScenarioKind, memberId: string) => void;
  userPaused: boolean;
  togglePause: () => void;
  sendPresenterLine: (
    speaker: "member" | "advocate",
    text: string,
    source: "presenter_typed" | "presenter_picked",
  ) => void;
  endCall: () => void;
  human: (path: string, extra?: Record<string, unknown>) => Promise<void>;
  selectFocus: (kind: NeedKind) => void;
  disclosureNetwork: string;
  finishReview: () => void;
  submitEnrollment: () => Promise<void>;
};

export function AdvocateScreen(props: AdvocateScreenProps) {
  const {
    session,
    busy,
    error,
    demoDetails,
    setDemoDetails,
    scenario,
    setScenario,
    memberId,
    setMemberId,
    members,
    questions,
    callerText,
    setCallerText,
    advocateText,
    setAdvocateText,
    pickedQuestion,
    setPickedQuestion,
    presenterNotice,
    dispositionChoice,
    setDispositionChoice,
    stepMode,
    setStepMode,
    scriptMemberId,
    scriptMemberLabel,
    startCall,
    userPaused,
    togglePause,
    sendPresenterLine,
    endCall,
    human,
    selectFocus,
    disclosureNetwork,
    finishReview,
    submitEnrollment,
  } = props;

  const [sourcePop, setSourcePop] = useState<{
    tag: string;
    body: string;
    highlight?: string;
    extra?: string;
  } | null>(null);
  const [thumbPop, setThumbPop] = useState<{
    cardId: string;
    kind: string;
    sources: string[];
  } | null>(null);
  const [thumbReason, setThumbReason] = useState("");
  const [thumbNote, setThumbNote] = useState("");
  const [chooseOutcome, setChooseOutcome] = useState(false);
  const transcriptLinesRef = useRef<HTMLDivElement | null>(null);
  const [pinCard, setPinCard] = useState<string | null>(null);
  const [answerReleased, setAnswerReleased] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const answerShownAt = useRef<number | null>(null);
  const answerStampRef = useRef("");
  const lineSeenAt = useRef(new Map<string, number>());
  const [nbaShown, setNbaShown] = useState<{ key: string; at: number } | null>(null);
  const lastSessionForClocks = useRef<string | null>(null);
  const kindAppearances = useRef<
    { kind: string; elapsed: string; clock: string; key: string }[]
  >([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      e.preventDefault();
      togglePause();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSourcePop(null);
        setThumbPop(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [togglePause]);

  const memberVisible = session?.auth?.decision.toLowerCase() === "valid";
  const memberName = session?.member
    ? `${session.member.name.given} ${session.member.name.family}`
    : null;
  const given = session?.member?.name.given ?? "Caller";
  const greetingReq = session?.disclosures.find((d) => d.requirementId === "DEMO-GREETING-v1");
  const pricingReq = session?.disclosures.find((d) => d.requirementId === "DEMO-PRICING-v1");
  const closingReq = session?.disclosures.find((d) => d.requirementId === "DEMO-CLOSING-v2");
  const statementDue = session ? requiredWordingOnNow(session) : false;
  const displayLines = compactTranscript(session?.transcript ?? []);
  if (session?.sessionId !== lastSessionForClocks.current) {
    lastSessionForClocks.current = session?.sessionId ?? null;
    lineSeenAt.current.clear();
  }
  useEffect(() => {
    const box = transcriptLinesRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [displayLines.length, displayLines[displayLines.length - 1]?.id]);
  useEffect(() => {
    setNbaShown(null);
  }, [session?.sessionId]);

  const legalChips = session
    ? [
        obligationChip(
          greetingReq?.plainName,
          "Greeting",
          greetingRailStatus(session),
        ),
        obligationChip(pricingReq?.plainName, "Pricing disclaimer", session.pricing),
        obligationChip(closingReq?.plainName, "Closing statement", session.closing),
      ].filter(Boolean)
    : [];

  const why = session
    ? session.ivrReason ?? session.callType ?? null
    : null;

  const playing = Boolean(session) && !userPaused && !session?.callEnd.ended;
  const aiOk =
    session?.modelHealth?.luna?.ok !== false &&
    session?.modelHealth?.terra?.ok !== false;

  type CardKind =
    | "legal"
    | "answer"
    | "suggestion"
    | "enrollment"
    | "transfer"
    | "wrap"
    | "review";

  const rec = session?.recommendation;
  const enrollHold =
    Boolean(session?.enrollment.readback) &&
    !session?.enrollment.submitted &&
    !session?.enrollment.withdrawn &&
    session?.consent.enrollment === "absolute_yes";
  const transferHold =
    (rec?.kind === "warm_transfer" && rec.status === "pending") ||
    Boolean(session?.handoffDraft && !session?.transfer.destinationConfirmed) ||
    Boolean(
      session?.transfer.destinationConfirmed &&
        session.closing === "exact_timely" &&
        !session.transfer.connectionStatus,
    );

  const junkNow =
    /^(Phone menu|Caller verified|Recorded-line greeting due now|Call connected — greet the caller)$/i.test(
      session?.nowCard.title ?? "",
    );
  const lookingUp =
    !junkNow &&
    (session?.nowCard.title === "Working on it" ||
      (session?.nowCardOrigin === "answer" &&
        !(session.nowCard.body ?? "").trim() &&
        Boolean(session.nowCard.title)));
  const lastMemberFinal = [...(session?.transcript ?? [])]
    .reverse()
    .find(
      (l) =>
        l.speaker === "member" &&
        (l.stability === "final" || l.stability === "corrected"),
    );
  const needs = session?.needs ?? [];
  const lastNeedDirect = needs.find(
    (n) => n.sourceUtteranceId === lastMemberFinal?.id,
  );
  const lastNeedByQuery = lastMemberFinal
    ? [...needs]
        .reverse()
        .find(
          (n) =>
            n.queryText &&
            n.queryText.replace(/\s+/g, " ").trim() ===
              lastMemberFinal.text.replace(/\s+/g, " ").trim(),
        )
    : undefined;
  const parkedKind = lastMemberFinal
    ? parkedNeedKindForUtterance(
        needs,
        lastMemberFinal.text,
        [
          ...(session?.prefetch?.prescriptions ?? []).map((p) => p.drugName),
          ...(session?.quotes ?? []).map((q) => q.drugName),
          ...(session?.enrollment.medications ?? []),
        ].filter(Boolean),
      )
    : undefined;
  const parkedNeed = parkedKind
    ? needs.find((n) => n.kind === parkedKind && needHasRealAnswer(n))
    : undefined;
  const lastNeed =
    parkedNeed ??
    lastNeedByQuery ??
    (parkedKind ? needs.find((n) => n.kind === parkedKind) : undefined) ??
    lastNeedDirect ??
    (session?.nowCardNeedKind
      ? needs.find((n) => n.kind === session.nowCardNeedKind)
      : undefined);
  const needForLast = needHasRealAnswer(lastNeed)
    ? lastNeed
    : lastNeed
      ? [...needs]
          .reverse()
          .find((n) => n.kind === lastNeed.kind && needHasRealAnswer(n))
      : [...needs]
          .reverse()
          .find(
            (n) =>
              needHasRealAnswer(n) &&
              (n.sourceUtteranceId === lastMemberFinal?.id ||
                n.queryText === lastMemberFinal?.text),
          );
  const comparisonNeed = (session?.needs ?? []).find(
    (n) => n.kind === "prospective_comparison" && Boolean(n.answer?.body),
  );
  const comparisonYesNow =
    session?.consent.comparison === "absolute_yes" &&
    lastMemberFinal?.id === session?.consent.comparisonUtteranceId &&
    Boolean(comparisonNeed);
  const coverageOfferLine = [...(session?.transcript ?? [])]
    .reverse()
    .find(
      (l) =>
        l.speaker === "advocate" &&
        (l.stability === "final" || l.stability === "corrected") &&
        /coverage review/i.test(l.text),
    );
  const memberAgreedTransfer =
    Boolean(session?.transfer.agreedThisCall) ||
    /member agreed/i.test(
      (session?.needs ?? []).find((n) => n.kind === "coverage_status")?.flowStep ?? "",
    ) ||
    Boolean(
      session?.coverage &&
        coverageOfferLine &&
        lastMemberFinal &&
        lastMemberFinal.receivedAt > coverageOfferLine.receivedAt,
    );
  const lastLooksLikeQuestion = /\?/.test(lastMemberFinal?.text ?? "");
  const nowHasRealAnswer =
    Boolean((session?.nowCard.body ?? "").trim()) &&
    !junkNow &&
    !lookingUp &&
    session?.nowCardOrigin === "answer";
  const openLookupForLast = Boolean(
    lastMemberFinal &&
      (session?.lookupProgress ?? []).some(
        (p) =>
          p.answeredAt == null &&
          (p.sourceUtteranceId === lastMemberFinal.id ||
            p.question.replace(/\s+/g, " ").trim() ===
              lastMemberFinal.text.replace(/\s+/g, " ").trim()),
      ),
  );
  const loopForLast = Boolean(
    lastMemberFinal &&
      session?.answerLoopAnchor &&
      (session.answerLoopAnchor.sourceUtteranceId === lastMemberFinal.id ||
        session.answerLoopAnchor.question.replace(/\s+/g, " ").trim() ===
          lastMemberFinal.text.replace(/\s+/g, " ").trim()) &&
      // Anchor survives after Terra paints — only treat as in-flight while Now
      // still has no say for this line.
      !(
        session.nowCardOrigin === "answer" &&
        Boolean((session.nowCard.body ?? "").trim())
      ),
  );
  const lastNeedPreparing = Boolean(
    lastNeed &&
      !needHasRealAnswer(lastNeed) &&
      (lastNeed.guidance === "preparing" ||
        lastNeed.status === "active" ||
        lastNeed.status === "deferred"),
  );
  const answerReadyForLast = needHasRealAnswer(needForLast);
  // Anchor matching means "we're working this line", not "its say is on Now".
  // While hist Terra runs, refill may still sit on Now — do not treat that as
  // the hist answer.
  const answerOnNowForLast =
    Boolean((session?.nowCard.body ?? "").trim()) &&
    session?.nowCardOrigin === "answer" &&
    Boolean(
      (session.nowCardNeedKind &&
        needForLast?.kind === session.nowCardNeedKind &&
        needHasRealAnswer(needForLast) &&
        (session.nowCard.body ?? "").trim() ===
          (needForLast.answer?.body ?? "").trim()) ||
        (session.nowCardNeedKind &&
          lastNeed?.kind === session.nowCardNeedKind &&
          needHasRealAnswer(lastNeed) &&
          (session.nowCard.body ?? "").trim() ===
            (lastNeed.answer?.body ?? "").trim()),
    );
  const answerMatchesLastLine =
    (answerReadyForLast &&
      Boolean(
        lastNeedDirect ||
          lastNeedByQuery ||
          (parkedNeed &&
            lastMemberFinal &&
            (/\?/.test(lastMemberFinal.text) ||
              /\b(so,? the|what about (that|those)|those amounts|that price|back to (that|it|the)|actually first)\b/i.test(
                lastMemberFinal.text,
              ))),
      )) ||
    answerOnNowForLast;
  const awaitingLast =
    lastLooksLikeQuestion &&
    !answerMatchesLastLine &&
    !comparisonYesNow &&
    !memberAgreedTransfer &&
    !nowHasRealAnswer;
  // Prior answer may still sit on session.nowCard while Terra judges the new
  // line — treat that as looking up so tip/suggestion cannot steal the card.
  const lookingUpThisLine =
    !comparisonYesNow &&
    !answerMatchesLastLine &&
    (lookingUp ||
      awaitingLast ||
      openLookupForLast ||
      loopForLast ||
      lastNeedPreparing);
  const answeringThisLine =
    Boolean(lastMemberFinal) &&
    (answerMatchesLastLine || lookingUpThisLine || comparisonYesNow);
  const realAnswerOnNow = nowHasRealAnswer;
  const greetingLeftover =
    junkNow ||
    session?.nowCardOrigin === "system" ||
    /recorded-line greeting|thank you for calling humana/i.test(
      `${session?.nowCard.title ?? ""} ${session?.nowCard.body ?? ""}`,
    );
  const lookupQuestion =
    session?.answerLoopAnchor?.question ||
    session?.rightNowLine ||
    lastMemberFinal?.text ||
    "";
  const paintAnswer = comparisonYesNow && comparisonNeed?.answer
    ? {
        title: comparisonNeed.answer.title || session?.nowCard.title || "",
        headline: comparisonNeed.answer.title || session?.nowCard.headline,
        body: comparisonNeed.answer.body,
        statements: comparisonNeed.answer.statements,
        usedSources: comparisonNeed.answer.usedSources,
        earlyFacts: [] as { text: string; source: string }[],
      }
    : answerMatchesLastLine && needForLast?.answer
      ? {
          title: needForLast.answer.title || session?.nowCard.title || "",
          headline: needForLast.answer.title || session?.nowCard.headline,
          body: needForLast.answer.body,
          statements: needForLast.answer.statements,
          usedSources: needForLast.answer.usedSources,
          earlyFacts: [] as { text: string; source: string }[],
        }
    : answerOnNowForLast && session?.nowCard
      ? session.nowCard
    : lookingUpThisLine
      ? {
          title: lookupQuestion,
          headline: lookupQuestion,
          body: "",
          statements: undefined,
          usedSources: undefined,
          earlyFacts: [] as { text: string; source: string }[],
          liveSteps: ["Looking this up…"],
        }
    : greetingLeftover
      ? {
          title: session?.nowCard.title ?? "",
          headline: session?.nowCard.headline || session?.nowCard.title || "",
          body: session?.nowCard.body ?? "",
          statements: session?.nowCard.statements,
          usedSources: session?.nowCard.usedSources,
          earlyFacts: session?.nowCard.earlyFacts ?? [],
          liveSteps: session?.nowCard.liveSteps ?? [],
        }
      : session?.nowCard;
  useEffect(() => {
    setPinCard(null);
    setAnswerReleased(false);
  }, [session?.sessionId, lastMemberFinal?.id]);
  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [session?.sessionId]);
  // Greeting owns Now only before identity — same gate as greetingWordingOnNow.
  const identityOk =
    session?.identityStatus === "VALID" || Boolean(session?.auth);
  const greetingOpen =
    Boolean(greetingReq) &&
    !session?.callEnd.ended &&
    !identityOk &&
    (session?.greeting === "due_now" || session?.greeting === "paraphrased");
  const keepGreeting =
    greetingOpen ||
    (Boolean(greetingReq) &&
      !session?.callEnd.ended &&
      !identityOk &&
      !realAnswerOnNow &&
      !lookingUp &&
      !needForLast &&
      !awaitingLast &&
      (session?.greeting === "exact_timely" || session?.greeting === "late_finding") &&
      (junkNow ||
        !lastMemberFinal ||
        lastMemberFinal.stability === "uncertain"));

  // Only a need-bound say on Now can mark "caller moved on". Do not fall back
  // to answerLoopAnchor — that lets a pending tip steal consent clarification.
  const currentAnswerUtterance = session?.nowCardNeedKind
    ? needs.find((n) => n.kind === session.nowCardNeedKind)?.sourceUtteranceId
    : undefined;
  const callerMovedOn =
    Boolean(lastMemberFinal?.id) &&
    Boolean(currentAnswerUtterance) &&
    lastMemberFinal!.id !== currentAnswerUtterance &&
    !lookingUpThisLine &&
    !awaitingLast;
  const clarifyHolds = Boolean(session && clarificationHoldsNow(session));
  const answerStamp = `${session?.nowCardNeedKind ?? ""}|${(paintAnswer?.body ?? "").slice(0, 80)}`;
  if (
    realAnswerOnNow &&
    !clarifyHolds &&
    answerStampRef.current !== answerStamp
  ) {
    answerStampRef.current = answerStamp;
    answerShownAt.current = Date.now();
  }
  const answerReadLongEnough =
    Boolean(answerShownAt.current) &&
    !clarifyHolds &&
    clockMs - (answerShownAt.current ?? 0) >= 3500;
  // Tip may take Now after the current say has been readable long enough (or
  // the caller moved on). Do not keep blocking on answerMatchesLastLine — that
  // left Money-saving tip stuck in Up next for the whole hist dwell window.
  const recMayTakeNow =
    rec?.status === "pending" &&
    !lookingUpThisLine &&
    !awaitingLast &&
    !comparisonYesNow &&
    !statementDue &&
    !keepGreeting &&
    !clarifyHolds &&
    !(
      enrollHold &&
      lastMemberFinal?.id === session?.consent.enrollmentUtteranceId
    ) &&
    !transferHold &&
    !memberAgreedTransfer;
  const recTurn =
    recMayTakeNow &&
    (answerReadLongEnough ||
      callerMovedOn ||
      answerReleased ||
      pinCard === "suggestion" ||
      !realAnswerOnNow);

  let cardKind: CardKind = "answer";
  if (session?.reviewStep === 2) cardKind = "review";
  else if (session?.callEnd.ended) cardKind = "wrap";
  else if (statementDue) cardKind = "legal";
  else if (clarifyHolds) cardKind = "answer";
  else if (keepGreeting) cardKind = "legal";
  else if (
    enrollHold &&
    lastMemberFinal?.id === session?.consent.enrollmentUtteranceId &&
    lastNeed?.kind !== "coverage_status" &&
    rec?.kind !== "warm_transfer"
  ) {
    cardKind = "enrollment";
  }
  else if (
    (transferHold || memberAgreedTransfer) &&
    (memberAgreedTransfer || lastNeed?.kind !== "coverage_status")
  ) {
    cardKind = "transfer";
  }
  else if (lookingUpThisLine || awaitingLast) cardKind = "answer";
  else if (recTurn) cardKind = "suggestion";
  else if (answeringThisLine) cardKind = "answer";
  else if (realAnswerOnNow) cardKind = "answer";
  else if (rec?.status === "pending") cardKind = "suggestion";
  else cardKind = "answer";
  if (pinCard === "suggestion" && rec?.status === "pending" && !session?.callEnd.ended && !lookingUpThisLine && !awaitingLast && !memberAgreedTransfer) {
    cardKind = "suggestion";
  }
  if (pinCard === "answer" && (session?.nowCardOrigin === "answer" || answerMatchesLastLine) && !session?.callEnd.ended) {
    cardKind = "answer";
  }

  const onScreenNeedKind: NeedKind | null =
    cardKind === "answer"
      ? (answerMatchesLastLine
          ? needForLast?.kind ?? null
          : lookingUpThisLine
            ? (session?.answerLoopAnchor?.needKind ??
              lastNeed?.kind ??
              session?.nowCardNeedKind ??
              null)
            : session?.nowCardNeedKind ?? null)
      : null;
  const questionsOnCall = (() => {
    const rows = (session?.needs ?? []).filter(
      (n) =>
        n.kind !== "unrecognized_request" &&
        n.kind !== "service_election" &&
        n.kind !== "unsupported_work",
    );
    const byKind = new Map<string, (typeof rows)[0]>();
    for (const n of rows) byKind.set(n.kind, n);
    return [...byKind.values()].map((n) => ({
      kind: n.kind,
      title: questionTitle(n.queryText, n.answer?.title),
      status: questionStatus(
        session!,
        n.kind,
        n.status,
        n.guidance,
        Boolean(n.answer?.body),
        onScreenNeedKind === n.kind,
      ),
    }));
  })();

  const upNext: { id: string; title: string; pill: string; onClick: () => void }[] = [];
  if (session && cardKind === "legal") {
    if (session.nowCardOrigin === "answer" && session.nowCard.body) {
      const title = session.nowCard.headline || session.nowCard.title;
      upNext.push({
        id: "answer",
        title,
        pill: clarificationHoldsNow(session)
          ? HUMANA_KIND.tellCustomer
          : HUMANA_KIND.answer,
        onClick: () => setPinCard("answer"),
      });
    }
  } else if (session && cardKind === "suggestion" && realAnswerOnNow) {
    upNext.push({
      id: "answer",
      title: paintAnswer?.headline || session.nowCard.headline || session.nowCard.title,
      pill: clarificationHoldsNow(session)
        ? HUMANA_KIND.tellCustomer
        : HUMANA_KIND.answer,
      onClick: () => setPinCard("answer"),
    });
  }
  if (session && rec?.status === "pending" && cardKind !== "suggestion") {
    upNext.push({
      id: "rec",
      title: rec.title,
      pill: kindFromPlaybook(rec.playbookPassage, rec.pillName),
      onClick: () => setPinCard("suggestion"),
    });
  }
  const seenUp = new Set<string>(upNext.map((u) => u.id));
  if (rec?.status === "pending") seenUp.add(rec.kind);
  for (let i = 0; i < (session?.waitingRecommendations ?? []).length; i++) {
    const wr = session!.waitingRecommendations[i];
    if (wr.status !== "pending") continue;
    if (rec && wr.kind === rec.kind) continue;
    const id = `wait-${i}-${wr.kind}`;
    if (seenUp.has(wr.kind) || seenUp.has(id)) continue;
    seenUp.add(wr.kind);
    seenUp.add(id);
    upNext.push({
      id,
      title: wr.title,
      pill: kindFromPlaybook(wr.playbookPassage, wr.pillName),
      onClick: () => {
        void human("/api/session/human/promote-tip", { kind: wr.kind }).then(
          () => setPinCard("suggestion"),
        );
      },
    });
  }
  for (const n of session?.needs ?? []) {
    if (
      (n.guidance === "deferred_valid" || n.guidance === "ready") &&
      n.answer?.body &&
      n.kind !== session?.nowCardNeedKind &&
      n.kind !== needForLast?.kind &&
      n.kind !== "unrecognized_request" &&
      n.kind !== "service_election" &&
      !seenUp.has(n.kind)
    ) {
      seenUp.add(n.kind);
      upNext.push({
        id: n.kind,
        title: displayAnswerTitle(n.queryText, n.answer.title),
        pill: HUMANA_KIND.answer,
        onClick: () => selectFocus(n.kind),
      });
    }
  }

  const pillClass =
    cardKind === "legal"
      ? "legal"
      : cardKind === "answer" && clarifyHolds
        ? "tell"
        : cardKind === "answer"
          ? "answer"
          : "teal";
  const needsPermission =
    cardKind === "enrollment" ||
    cardKind === "transfer" ||
    cardKind === "wrap";

  const headline = (() => {
    if (cardKind === "legal") {
      if (session?.closing === "due_now" || session?.closing === "unable_to_verify") {
        return "Read this closing, word for word";
      }
      if (greetingOpen || keepGreeting) {
        return "Read this greeting, word for word";
      }
      if (session?.pricing === "due_now" || session?.nudge) {
        return `Read this to ${given}, word for word`;
      }
      return session?.nowCard.title ?? "Read this, word for word";
    }
    if (cardKind === "enrollment") return `Read this back to ${given}, then submit`;
    if (cardKind === "transfer") return `Transfer ${given} to Coverage Review`;
    if (cardKind === "wrap") return "Your call notes are written — check them and confirm";
    if (cardKind === "review") return "How did the AI do on this call?";
    if (cardKind === "suggestion") return rec?.title ?? session?.nowCard.title ?? "";
    return paintAnswer?.headline || paintAnswer?.title || "";
  })();
  const pillText =
    cardKind === "answer" &&
    !headline &&
    !(paintAnswer?.body ?? session?.nowCard.body ?? "").trim()
      ? ""
      : humanaKindForCard(cardKind, rec, { tellCustomer: clarifyHolds }) ?? "";

  const legalText =
    session?.closing === "due_now" || session?.closing === "unable_to_verify"
      ? closingReq?.verbatimText
      : greetingOpen || keepGreeting
        ? greetingReq?.verbatimText
        : session?.pricing === "due_now" || session?.nudge
          ? pricingReq?.verbatimText
          : greetingReq?.verbatimText;

  const sayText = (paintAnswer?.body ?? "").trim();
  const lookupHint =
    (paintAnswer?.liveSteps ?? session?.nowCard.liveSteps ?? []).at(-1) ||
    (lookingUpThisLine || awaitingLast ? "Looking this up…" : "");
  // Cite sources only for need-bound answers. Clarify / scripting must not
  // inherit the call-wide retrieval list or a prior answer's usedSources.
  const needOnNow = session?.nowCardNeedKind
    ? needs.find((n) => n.kind === session.nowCardNeedKind)
    : null;
  const storedSources = clarifyHolds
    ? []
    : (paintAnswer?.usedSources ??
      session?.nowCard.usedSources ??
      needOnNow?.answer?.usedSources ??
      []);
  const derivedSources =
    !clarifyHolds &&
    Boolean(session?.nowCardNeedKind) &&
    cardKind === "answer" &&
    storedSources.length === 0
      ? usedKnowledgeSources(
          session?.retrievedSources ?? [],
          paintAnswer?.statements ??
            session?.nowCard.statements ??
            needOnNow?.answer?.statements,
          paintAnswer?.earlyFacts ?? session?.nowCard.earlyFacts,
        )
      : [];
  const sourceRows = (storedSources.length ? storedSources : derivedSources).map((s) => ({
    text: demoDetails ? s.text : hideDemoIds(s.text),
    tag: sourceLabel(s.tag, demoDetails),
    rawTag: s.tag,
    sid: s.id,
  }));
  const answerFromLine = clarifyHolds
    ? ""
    : fromAnswerSources(
        sourceRows.length
          ? sourceRows.map((s) => ({ tag: s.rawTag }))
          : (paintAnswer?.statements ?? session?.nowCard.statements ?? []).map((s) => ({
              tag: s.sourceTag,
            })),
      );
  const facts = (paintAnswer?.statements ?? session?.nowCard.statements ?? [])
    .filter((s) => s.confirmed !== false)
    .slice(0, 3);
  const nbaStampKey = session
    ? [
        cardKind,
        cardKind === "legal"
          ? requiredPricingOnNow(session) || session.pricing === "due_now"
            ? "pricing"
            : session.closing === "due_now" || session.closing === "unable_to_verify"
              ? "closing"
              : "greeting"
          : cardKind === "answer"
            ? session.nowCardNeedKind ||
              session.answerLoopAnchor?.question ||
              session.rightNowLine ||
              headline
            : cardKind === "suggestion"
              ? rec?.kind || rec?.title || pillText
              : cardKind,
      ].join("|")
    : "";
  useEffect(() => {
    if (!session || !nbaStampKey) return;
    setNbaShown((prev) => {
      if (prev?.key === nbaStampKey) return prev;
      return { key: nbaStampKey, at: Date.now() };
    });
  }, [session?.sessionId, nbaStampKey, session]);
  const nbaShownAt = nbaShown?.key === nbaStampKey ? nbaShown.at : undefined;
  useEffect(() => {
    if (!session || !pillText || cardKind === "review") return;
    if (nbaStampKey === "answer|Call connected — greet the caller") return;
    const last = kindAppearances.current.at(-1);
    if (last?.key === nbaStampKey && last.kind === pillText) return;
    kindAppearances.current.push({
      kind: pillText,
      elapsed: formatElapsed(session.elapsedMs),
      clock: formatClock(Date.now()),
      key: nbaStampKey,
    });
    (
      window as unknown as {
        __kindAppearances?: typeof kindAppearances.current;
      }
    ).__kindAppearances = kindAppearances.current;
  }, [session, pillText, nbaStampKey, cardKind]);

  function lineClock(id: string, receivedAt?: number) {
    if (receivedAt) return formatClock(receivedAt);
    if (!lineSeenAt.current.has(id)) lineSeenAt.current.set(id, Date.now());
    return formatClock(lineSeenAt.current.get(id)!);
  }

  function openSource(sourceId: string | undefined, tag: string, fallback: string) {
    const retrieved = session?.retrievedSources.find((s) => s.id === sourceId);
    const st = session?.nowCard.statements?.find((s) => s.sourceId === sourceId);
    const body = retrieved?.text || fallback;
    const highlight =
      st?.found?.[0] ||
      st?.lookedFor?.[0] ||
      (st?.text.match(/\$[\d.]+/)?.[0] ?? undefined);
    setSourcePop({
      tag: `From ${tag.toLowerCase()}`,
      body: demoDetails ? body : hideDemoIds(body),
      highlight,
      extra: demoDetails
        ? [retrieved?.id, retrieved?.sourceTag, "simulated"].filter(Boolean).join(" · ")
        : undefined,
    });
  }

  async function sendThumb(thumb: "up" | "down", kind: string, cardId: string) {
    const sources = facts.map((f) => f.sourceTag);
    if (thumb === "down") {
      setThumbPop({ cardId, kind, sources });
      setThumbReason("");
      setThumbNote("");
    } else {
      await human("/api/session/human/thumb", {
        cardId,
        kind,
        thumb,
        sources,
        advocateDid: "feedback",
      });
    }
    if (cardKind === "answer" && rec?.status === "pending") {
      setAnswerReleased(true);
    }
    const actionable =
      cardKind === "suggestion" &&
      (rec?.advocateControl ?? "offer_dismiss") === "offer_dismiss" &&
      rec?.kind !== "warm_transfer";
    if (actionable) {
      if (thumb === "up") {
        if (rec?.kind === "objection_retail") {
          await human("/api/session/human/use-objection");
        } else {
          await human("/api/session/human/offer", { decision: "offer" });
        }
      } else {
        await human("/api/session/human/offer", { decision: "dismiss" });
      }
    }
  }

  async function submitThumb() {
    if (!thumbPop) return;
    await human("/api/session/human/thumb", {
      cardId: thumbPop.cardId,
      kind: thumbPop.kind,
      thumb: "down",
      reason: thumbReason || undefined,
      note: thumbNote || undefined,
      sources: thumbPop.sources,
      advocateDid: "feedback",
    });
    setThumbPop(null);
  }

  const outcome = session?.disposition.options.find(
    (o) => o.code === (session.disposition.recommended ?? ""),
  );

  const reviewRows = (() => {
    const named = (session?.shownCards ?? []).map((row) => ({
      ...row,
      kind:
        /legal|greeting|pricing|closing/i.test(row.kind)
          ? HUMANA_KIND.legal
          : /enroll/i.test(row.kind)
            ? HUMANA_KIND.enrollment
            : /transfer/i.test(row.kind)
              ? HUMANA_KIND.transfer
              : /dispos|wrap|outcome/i.test(row.kind)
                ? HUMANA_KIND.disposition
                : /object|rebut|reply/i.test(row.kind)
                  ? HUMANA_KIND.objection
                  : /next best|tip|suggest/i.test(row.kind)
                    ? HUMANA_KIND.nba
                    : /answer/i.test(row.kind)
                      ? HUMANA_KIND.answer
                      : row.kind,
    }));
    if (named.length) return named;
    const rows: SessionState["shownCards"] = [];
    if (session?.greeting && session.greeting !== "not_applicable") {
      rows.push({
        id: "legal",
        kind: HUMANA_KIND.legal,
        description: "Required wording",
        thumb: null,
      });
    }
    for (const n of session?.needs ?? []) {
      if (n.answer?.body) {
        rows.push({
          id: `answer-${n.kind}`,
          kind: HUMANA_KIND.answer,
          description: n.answer.title || n.queryText || n.kind,
          thumb: null,
        });
      }
    }
    if (rec) {
      rows.push({
        id: "rec",
        kind: kindFromPlaybook(rec.playbookPassage, rec.pillName),
        description: rec.title,
        thumb: null,
      });
    }
    if (session?.enrollment.readback) {
      rows.push({
        id: "enroll",
        kind: HUMANA_KIND.enrollment,
        description: "Read-back and submit",
        thumb: null,
      });
    }
    if (session?.transfer.agreedThisCall || session?.handoffDraft) {
      rows.push({
        id: "transfer",
        kind: HUMANA_KIND.transfer,
        description: "Transfer to Coverage Review",
        thumb: null,
      });
    }
    if (session?.disposition.recommended) {
      rows.push({
        id: "disposition",
        kind: HUMANA_KIND.disposition,
        description: outcome?.meaning ?? session.disposition.recommended,
        thumb: null,
      });
    }
    return rows;
  })();

  return (
    <main
      className={userPaused ? "workspace paused" : "workspace"}
      onClick={() => {
        if (sourcePop) setSourcePop(null);
      }}
    >
      <div className="demo-bar">
        {session && !session.callEnd.ended ? (
          <button type="button" className="pause-btn" onClick={togglePause}>
            {userPaused ? (
              <>
                <svg className="pause-ico" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M3 2.2 9.6 6 3 9.8V2.2z" fill="currentColor" />
                </svg>
                Resume call
              </>
            ) : (
              <>
                <svg className="pause-ico" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <rect x="2.4" y="2" width="2.4" height="8" rx="0.4" fill="currentColor" />
                  <rect x="7.2" y="2" width="2.4" height="8" rx="0.4" fill="currentColor" />
                </svg>
                Pause call
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="pause-btn"
            disabled={busy}
            onClick={() => startCall(scenario, scriptMemberId ?? memberId)}
          >
            {busy ? "Starting…" : "Start call"}
          </button>
        )}
        <span className="play-status">
          <span className={playing ? "playing-dot" : "playing-dot off"} />{" "}
          {session?.callEnd.ended
            ? "Call ended"
            : userPaused
              ? "Call is paused"
              : session
                ? "Call is playing"
                : "Not started"}
        </span>
        {session ? (
          <span className="scenario-plain">
            {scriptMemberLabel ??
              members.find((m) => m.id === memberId)?.label ??
              "Member"}
          </span>
        ) : (
          <label>
            Scenario
            <select
              value={scenario}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as ScenarioKind;
                setScenario(next);
              }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!session && !scriptMemberId && (
          <select
            value={memberId}
            disabled={busy}
            onChange={(e) => setMemberId(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        {session && (
          <>
            <input
                className="grow"
                placeholder="Type what the caller says…"
                value={callerText}
                disabled={!memberVisible || session.callEnd.ended || busy}
                onChange={(e) => setCallerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendPresenterLine("member", callerText, "presenter_typed");
                  }
                }}
              />
            <input
                className="grow advocate-say"
                placeholder="Type what you say…"
                value={advocateText}
                disabled={session.callEnd.ended || busy}
                onChange={(e) => setAdvocateText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendPresenterLine("advocate", advocateText, "presenter_typed");
                  }
                }}
              />
            <label>
              Try a question
              <select
                value={pickedQuestion}
                disabled={!memberVisible || session.callEnd.ended || busy}
                onChange={(e) => setPickedQuestion(e.target.value)}
              >
                <option value="">Choose…</option>
                {questions.map((q) => (
                  <option key={q.question} value={q.question}>
                    {q.question}
                  </option>
                ))}
              </select>
            </label>
            {pickedQuestion && (
              <button
                type="button"
                className="pause-btn"
                onClick={() => {
                  void sendPresenterLine("member", pickedQuestion, "presenter_picked");
                  setPickedQuestion("");
                }}
              >
                Send
              </button>
            )}
          </>
        )}
        <div className="right-meta">
          <span title="Luna and Terra">
            <span
              className={`model-dot ${
                session?.modelHealth?.luna
                  ? session.modelHealth.luna.ok
                    ? "ok"
                    : "fail"
                  : "unknown"
              }`}
            />{" "}
            <span
              className={`model-dot ${
                session?.modelHealth?.terra
                  ? session.modelHealth.terra.ok
                    ? "ok"
                    : "fail"
                  : "unknown"
              }`}
            />{" "}
            AI connection: {session ? (aiOk ? "OK" : "issue") : "—"}
          </span>
          <label>
            <input
              type="checkbox"
              checked={stepMode}
              onChange={(e) => setStepMode(e.target.checked)}
            />
            Step mode
          </label>
          <label>
            Behind the scenes: {demoDetails ? "on" : "off"}
            <input
              type="checkbox"
              checked={demoDetails}
              onChange={(e) => setDemoDetails(e.target.checked)}
            />
          </label>
        </div>
      </div>

      <header className="strip">
        <span className="caller">
          <span
            className={`id-dot ${memberVisible ? "verified" : "unverified"}`}
            aria-hidden
          />
          {memberVisible && memberName ? memberName : "Caller"}
        </span>
        <span className="timer">
          {session?.callEnd.ended
            ? `Call ended · ${formatElapsed(session.elapsedMs)}`
            : session
              ? formatElapsed(session.elapsedMs)
              : "0:00"}
        </span>
        {why && (
          <span className="why">
            Call Reason: <strong>{why}</strong>
          </span>
        )}
        {session && !session.callEnd.ended && (
          <button type="button" className="end-call" onClick={endCall}>
            <svg
              className="hangup"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.51 13.3a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.49 4.89c.39.39.39 1.02 0 1.41l-2.26 2.26c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
            End call
          </button>
        )}
        <div className="legal-row">
          Legal statements
          {legalChips.map((c) => (
            <span key={c!.text} className={`legal-chip ${c!.kind}`}>
              {c!.text}
            </span>
          ))}
        </div>
      </header>

      <section className="now">
        {!session ? (
          <div className="landing">
            <p>Start a call from the presenter bar.</p>
          </div>
        ) : (
          <section className={`now-card ${cardKind === "legal" ? "legal-card" : cardKind === "answer" ? "answer-card" : "teal"}`}>
            <div className="nba-cap">
              <span>
                {cardKind === "review" ? "STEP 2 OF 2 · AFTER THE CALL" : ""}
              </span>
              {nbaShownAt && cardKind !== "review" ? (
                <time className="cue-time" dateTime={new Date(nbaShownAt).toISOString()}>
                  {formatClock(nbaShownAt)}
                </time>
              ) : null}
            </div>
            <div className="now-card-scroll">
            {(cardKind === "wrap" || cardKind === "review") && session ? (
              <QualityScoreLine
                sessionId={session.sessionId}
                reviewStep={session.reviewStep}
              />
            ) : null}
            {pillText ? (
            <div className="pill-row">
              <span className={`pill ${pillClass}`}>
                <PillGlyph kind={pillText} />
                {pillText}
              </span>
              {needsPermission && (
                <span className="perm-mark">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="8" r="3.2" />
                    <path d="M6 19c.8-3 3.1-5 6-5s5.2 2 6 5" />
                  </svg>
                  Requires human permission
                </span>
              )}
            </div>
            ) : null}
            <h3>{headline}</h3>
            {cardKind === "answer" && answerFromLine ? (
              <p className="from-line">{answerFromLine}</p>
            ) : null}

            {cardKind === "legal" &&
            legalText &&
            !(session.nudge?.heard && session.nudge.requiredText) ? (
              <div className="quote-box">“{legalText}”</div>
            ) : null}
            {cardKind === "legal" &&
            session.nudge?.heard &&
            session.nudge.requiredText ? (
              (() => {
                const aligned = alignedWordDiff(
                  session.nudge.heard,
                  session.nudge.requiredText,
                );
                const id = (s: string) => (demoDetails ? s : hideDemoIds(s));
                return (
                  <>
                    <div className="quote-box">
                      “{renderMarkedWords(aligned.requiredMarks, id)}”
                    </div>
                    <p className="diff-note">
                      <strong>What you said instead:</strong> “
                      {renderMarkedWords(aligned.heardMarks, id)}”
                    </p>
                    <p className="diff-note">
                      <strong>What was left out:</strong>{" "}
                      {aligned.leftOutPhrases.length
                        ? aligned.leftOutPhrases.map(id).join(" · ")
                        : "—"}
                    </p>
                  </>
                );
              })()
            ) : null}

            {cardKind === "answer" && (
              <>
                {!sayText && lookupHint ? (
                  <p className="lookup-hint" aria-live="polite">
                    {lookupHint}
                  </p>
                ) : null}
                {sayText ? (
                  <p className="say">
                    {advocateFacing(
                      demoDetails ? sayText : hideDemoIds(sayText),
                      given === "Caller" ? undefined : given,
                    )}
                  </p>
                ) : null}
                {sayText && sourceRows.length > 0 ? (
                  <>
                    <p className="sources-cap">Sources used</p>
                    <ul className="fact-list">
                      {sourceRows.map((f, i) => (
                        <li key={`${f.sid}-${f.tag}-${i}`}>
                          <span>{f.text}</span>
                          <button
                            type="button"
                            className="source-tag"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSource(f.sid, f.tag, f.text);
                            }}
                          >
                            {f.tag}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}

            {cardKind === "suggestion" && rec && (
              <>
                {rec.body ? (
                  <div className="quote-box teal">“{hideDemoIds(rec.body)}”</div>
                ) : null}
                <ul className="fact-list">
                  {suggestionFacts(rec).map((row, i) => (
                    <li key={`${row}-${i}`}>
                      <span>{demoDetails ? row : hideDemoIds(row)}</span>
                      <button
                        type="button"
                        className="source-tag"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSource(rec.playbookIds?.[0], sourceLabel(rec.sourceLabel, false), row);
                        }}
                      >
                        {sourceLabel(rec.sourceLabel, demoDetails)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {cardKind === "enrollment" && (
              <>
                <div className="quote-box teal">
                  “{hideDemoIds(session.enrollment.readback || session.nowCard.body)}”
                </div>
                <ul className="fact-list">
                  <li>
                    <span>
                      {given} said: “
                      {displayLines.find((l) => l.id === session.consent.enrollmentUtteranceId)
                        ?.text ??
                        displayLines
                          .filter((l) => l.speaker === "member")
                          .find((l) => /metformin only|enroll/i.test(l.text))?.text ??
                        "Yes, for metformin only."}
                      ”
                    </span>
                    <button type="button" className="source-tag">
                      This call
                    </button>
                  </li>
                </ul>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={session.consent.enrollment !== "absolute_yes"}
                    onClick={() => void submitEnrollment()}
                  >
                    Submit enrollment
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const quoted = [...new Set(session.quotes.map((q) => q.drugName))];
                      const extra = quoted.filter(
                        (d) =>
                          !session.enrollment.medications.some(
                            (m) => m.toLowerCase() === d.toLowerCase(),
                          ),
                      );
                      void human("/api/session/human/edit-enrollment-scope", {
                        medications: [...session.enrollment.medications, ...extra],
                      });
                    }}
                  >
                    Change what&apos;s included
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => human("/api/session/human/withdraw-enrollment")}
                  >
                    He changed his mind
                  </button>
                </div>
              </>
            )}

            {cardKind === "transfer" && (
              <>
                <ul className="fact-list">
                  <li>
                    <span>
                      {session.coverage?.requestedMedication
                        ? `His ${session.coverage.requestedMedication} review is still pending — no decision yet`
                        : "A coverage review is still pending"}
                    </span>
                    <button type="button" className="source-tag">
                      Coverage case
                    </button>
                  </li>
                  <li>
                    <span>Only the Coverage Review team can decide this</span>
                    <button type="button" className="source-tag">
                      Humana&apos;s guidance
                    </button>
                  </li>
                  <li>
                    <span>{given} agreed to be transferred</span>
                    <button type="button" className="source-tag">
                      This call
                    </button>
                  </li>
                </ul>
                <div className="actions">
                  {!session.transfer.destinationConfirmed ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => human("/api/session/human/confirm-transfer")}
                    >
                      Confirm transfer
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => human("/api/session/human/execute-transfer")}
                    >
                      Confirm transfer
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => human("/api/session/human/offer", { decision: "dismiss" })}
                  >
                    Not now
                  </button>
                </div>
                <p className="diff-note">
                  A short handoff note is written for the specialist when you confirm.
                </p>
              </>
            )}

            {cardKind === "wrap" && (
              <>
                <ul className="fact-list">
                  {(session.wrapLines?.length
                    ? session.wrapLines
                    : [{ text: session.wrapDraft, sourceTag: "This call", sourceId: "" }]
                  ).map((ln, i) => (
                    <li key={i}>
                      <span>{demoDetails ? ln.text : hideDemoIds(ln.text ?? "")}</span>
                      <button
                        type="button"
                        className="source-tag"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSource(ln.sourceId, sourceLabel(ln.sourceTag, false), ln.text ?? "");
                        }}
                      >
                        {sourceLabel(ln.sourceTag, demoDetails)}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="outcome-bar">
                  <span>
                    Suggested call outcome:{" "}
                    <strong>
                      {outcome?.meaning ?? session.disposition.recommended ?? "—"}
                    </strong>
                    {demoDetails && session.disposition.recommended
                      ? ` (${session.disposition.recommended})`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    disabled={Boolean(session.disposition.confirmed)}
                    onClick={() =>
                      human("/api/session/human/confirm-disposition", {
                        code: dispositionChoice || session.disposition.recommended,
                      })
                    }
                  >
                    Confirm call outcome
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setChooseOutcome((v) => !v)}
                  >
                    Choose another
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const next = window.prompt("Edit notes", session.wrapDraft);
                      if (next != null) {
                        void human("/api/session/human/save-wrap", { wrap: next });
                      }
                    }}
                  >
                    Edit notes
                  </button>
                </div>
                {chooseOutcome && (
                  <select
                    value={dispositionChoice || session.disposition.recommended || ""}
                    onChange={(e) => setDispositionChoice(e.target.value)}
                  >
                    {session.disposition.options.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.meaning}
                        {demoDetails ? ` (${o.code})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}

            {cardKind === "review" && (
              <>
                {reviewRows.map((row) => (
                  <div className="review-row" key={row.id}>
                    <span className="kind">{row.kind}</span>
                    <span>{row.description}</span>
                    <span className="thumbs" style={{ marginTop: 0, paddingTop: 0 }}>
                      <button
                        type="button"
                        className={row.thumb === "up" ? "on" : ""}
                        onClick={() =>
                          human("/api/session/human/thumb", {
                            cardId: row.id,
                            kind: row.kind,
                            thumb: "up",
                          })
                        }
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        className={row.thumb === "down" ? "on" : ""}
                        onClick={() =>
                          human("/api/session/human/thumb", {
                            cardId: row.id,
                            kind: row.kind,
                            thumb: "down",
                          })
                        }
                      >
                        👎
                      </button>
                    </span>
                  </div>
                ))}
                <div className="tally-row">
                  <div className="tally">
                    <h3>AI did on its own · {session.needs.filter((n) => n.answer).length}</h3>
                    <p>{HUMANA_KIND.answer}</p>
                  </div>
                  <div className="tally">
                    <h3>
                      AI suggested, you chose ·{" "}
                      {session.actionResults.filter((a) =>
                        /offer|dismiss|objection/i.test(a.kind),
                      ).length || (rec ? 1 : 0)}
                    </h3>
                    <p>
                      {HUMANA_KIND.nba} · {HUMANA_KIND.objection} · {HUMANA_KIND.transfer} ·{" "}
                      {HUMANA_KIND.disposition}
                    </p>
                  </div>
                  <div className="tally">
                    <h3>
                      Only you ·{" "}
                      {(session.enrollment.submitted ? 1 : 0) +
                        (session.transfer.connectionStatus ? 1 : 0)}
                    </h3>
                    <p>{HUMANA_KIND.enrollment}</p>
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="primary" onClick={finishReview}>
                    Finish
                  </button>
                </div>
              </>
            )}

            </div>
            {sourcePop && (
              <div
                className="source-pop"
                style={{ right: 28, bottom: 88 }}
                onClick={(e) => e.stopPropagation()}
              >
                <h4>{sourcePop.tag}</h4>
                <p>
                  <Highlighted text={sourcePop.body} highlight={sourcePop.highlight} />
                </p>
                {sourcePop.extra && <p className="bts">{sourcePop.extra}</p>}
              </div>
            )}

            {thumbPop && (
              <div className="thumb-pop" onClick={(e) => e.stopPropagation()}>
                <h4>What was wrong? (optional)</h4>
                <div className="reason-row">
                  {THUMB_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={thumbReason === r ? "on" : ""}
                      onClick={() => setThumbReason(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div>Add a note</div>
                <textarea
                  value={thumbNote}
                  onChange={(e) => setThumbNote(e.target.value)}
                />
                <div className="actions">
                  <button type="button" className="primary" onClick={() => void submitThumb()}>
                    Save
                  </button>
                </div>
              </div>
            )}

            {cardKind !== "wrap" && cardKind !== "review" && (
              <div className="thumbs">
                {cardKind === "suggestion" && (
                  <span className="hint">Thumbs up if you use it · thumbs down to skip it</span>
                )}
                <button
                  type="button"
                  onClick={() => void sendThumb("up", pillText, `${cardKind}:${headline}`)}
                >
                  👍
                </button>
                <button
                  type="button"
                  onClick={() => void sendThumb("down", pillText, `${cardKind}:${headline}`)}
                >
                  👎
                </button>
              </div>
            )}

            {demoDetails && (
              <pre className="bts">
                {disclosureNetwork}
                {"\n"}
                overlay: {session.overlay ?? "none"}
                {"\n"}
                quotes:{" "}
                {session.quotes
                  .map((q) =>
                    `${q.drugName} @ ${q.pharmacyName} $${q.estimatedMemberCost.value} ${
                      q.validityStatus === "invalidated"
                        ? "no longer valid — different pharmacy than the one being discussed"
                        : q.validityStatus
                    }`,
                  )
                  .join("; ") || "none"}
                {"\n"}
                {quoteAmountsMayRender(session.consent.comparison)
                  ? "comparison yes — amounts may render"
                  : "no prices before a clear yes"}
                {"\n"}
                last routes: {JSON.stringify(session.diagnostics.router.slice(-1))}
              </pre>
            )}
            {error && <p>{error}</p>}
            {presenterNotice && demoDetails && <p className="bts">{presenterNotice}</p>}
          </section>
        )}
      </section>

      <aside className="drawer">
        <section className="side-box">
          <h2>About the caller</h2>
          {session
            ? callerLines(session, Boolean(memberVisible)).map((l) => <p key={l}>{l}</p>)
            : <p>Details appear once the caller is verified.</p>}
        </section>
        {upNext.length > 0 && cardKind !== "wrap" && cardKind !== "review" && (
          <section className="side-box">
            <h2>Up next · {upNext.length} waiting</h2>
            {upNext.map((u) => (
              <button key={u.id} type="button" className="up-row" onClick={u.onClick}>
                <span>{u.title}</span>
                <span>{u.pill}</span>
              </button>
            ))}
          </section>
        )}
        <section className="side-box">
          <h2>Questions on this call</h2>
          {questionsOnCall.length === 0 && <p>Nothing yet</p>}
          {questionsOnCall.map((q) => (
            <div className="q-row" key={q.kind}>
              <span>{q.title}</span>
              <span className="st">{q.status}</span>
            </div>
          ))}
        </section>
      </aside>

      <section className="transcript" aria-label="Live Transcript">
        <h2>Live Transcript</h2>
        <div className="lines" ref={transcriptLinesRef}>
          {displayLines.map((line) => (
            <p
              key={line.id}
              className={`line${line.speaker === "advocate" ? " you" : " them"}`}
            >
              <time dateTime={new Date(line.receivedAt).toISOString()}>
                {lineClock(line.id, line.receivedAt)}
              </time>
              <span>
                <strong>
                  {line.speaker === "advocate"
                    ? "You"
                    : memberVisible && session?.member
                      ? session.member.name.given
                      : "Caller"}
                </strong>
                : {line.text}
              </span>
            </p>
          ))}
          {(!session || displayLines.length === 0) && (
            <p className="line muted">Nothing said yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
