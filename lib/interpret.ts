import { lunaStream, parseJsonObject } from "@/lib/openai";
import type { NeedKind, SessionState } from "@/lib/types";

export type Interpretation = {
  callTypeChange: string | null;
  refillCheck: "none" | "existing_request" | "current_readiness";
  historicalAsked: boolean;
  returnToHistorical: boolean;
  communicatedRefillReadiness: boolean;
  ninetyDayAsked: boolean;
  retailHesitation: boolean;
  serviceIntroducedByAdvocate: boolean;
  comparisonConsent: "none" | "hedge" | "absolute_yes";
  enrollmentConsent: "none" | "hedge" | "absolute_yes";
  electionMetforminOnly: boolean;
  electedMedications: string[];
  coverageAsked: boolean;
  memberAgreesTransfer: boolean;
  advocateOfferedTransfer: boolean;
  firmRefusal: boolean;
  smallTalkOnly: boolean;
  withdrawEnrollment: boolean;
  quotePharmacy: "lakeview" | "oak-street" | "centerwell" | null;
  quotePharmacyCorrection: boolean;
  quoteDrug: string | null;
  pricingTrigger: "historical_charges" | "prospective_estimate" | "none";
  focusKind: NeedKind | null;
  raw: string;
  ms: number;
  ttftMs: number | null;
  usage: { input_tokens: number; output_tokens: number; cached_tokens: number } | null;
  ok: boolean;
};

const CALL = {
  R: "Refill",
  P: "Pricing",
  E: "Education / enrollment",
  D: "Do-not-call",
  G: "General inquiry / unclassified",
} as const;

const REFILL = {
  n: "none",
  ex: "existing_request",
  rd: "current_readiness",
} as const;

const CONSENT = {
  n: "none",
  h: "hedge",
  y: "absolute_yes",
} as const;

const PHARM = {
  l: "lakeview",
  o: "oak-street",
  c: "centerwell",
} as const;

const PRICE = {
  n: "none",
  h: "historical_charges",
  p: "prospective_estimate",
} as const;

const FOCUS: Record<string, NeedKind> = {
  rs: "refill_status",
  hp: "historical_price",
  pc: "prospective_comparison",
  se: "service_education",
  sel: "service_election",
  cs: "coverage_status",
};

const DRUGS = ["metformin", "atorvastatin", "jardiance"] as const;

type Compact = {
  ct?: keyof typeof CALL | null;
  rf?: keyof typeof REFILL;
  ha?: 0 | 1;
  rt?: 0 | 1;
  cr?: 0 | 1;
  n90?: 0 | 1;
  rh?: 0 | 1;
  si?: 0 | 1;
  cc?: keyof typeof CONSENT;
  ec?: keyof typeof CONSENT;
  el?: 0 | 1;
  em?: string[];
  cv?: 0 | 1;
  ma?: 0 | 1;
  ao?: 0 | 1;
  fr?: 0 | 1;
  st?: 0 | 1;
  we?: 0 | 1;
  qp?: keyof typeof PHARM | null;
  qc?: 0 | 1;
  qd?: (typeof DRUGS)[number] | null;
  pt?: keyof typeof PRICE;
  fk?: keyof typeof FOCUS | null;
};

function on(v: unknown) {
  return v === 1 || v === true || v === "1";
}

const INTERPRET_STATIC = `Classify one utterance. Output exactly 23 space-separated tokens, no keys, no prose, no commas, no pipes:
ct rf ha rt cr n90 rh si cc ec el em cv ma ao fr st we qp qc qd pt fk
Allowed: ct - R P E D G ; rf n ex rd ; bits 0 or 1 only ; cc ec n h y ; em - or metformin or metformin+atorvastatin ; qp - l o c ; qd - metformin atorvastatin jardiance ; pt n h p ; fk - rs hp pc se sel cs
Rules: hist price stays R. D only if they ask not to be called. E only if advocate introduces 90-day/delivery or member asks how it works. rf=ex already-submitted refill; rd ready today. st=1 small talk only. ha=1 question about past paid amounts (then fk=hp). rt=1 return to deferred price. n90=1 how 90-day option works; n90=0 for estimate-at-pharmacy (use qp qd). rh=1 unsure delivery while keeping retail. fr=1 keep retail/no delivery. si=1 advocate introduces service. cc=h hedge; cc=y clear yes to scoped compare. qp/qd for named-pharmacy estimate. qc=1 pharmacy correction. el=1 split election; em delivery drugs. ec=y yes after scoped readback. we=1 withdraw. cv=1 pending coverage/approval status (then fk=cs). ao=1 advocate offers Coverage Review. ma=1 member agrees to transfer. pt=p future estimate; pt=h past charges.
Shots (invented, copy this layout):
last fill eleven vs forty → R n 1 0 0 0 0 0 n n 0 - 0 0 0 0 0 0 - 0 - n hp
SGLT2 request signed off yet → G n 0 0 0 0 0 0 n n 0 - 1 0 0 0 0 0 - 0 - n cs
walk me through ninety-day mail → E n 0 0 0 1 0 0 n n 0 - 0 0 0 0 0 0 - 0 - n se
ready if I drive today → R rd 0 0 1 0 0 0 n n 0 - 0 0 0 0 0 0 - 0 - n rs
yes I want you to compare both → E n 0 0 0 0 0 0 y n 0 - 0 0 0 0 0 0 - 0 - n pc
Defaults: n 0 -.`;

const CLASS_CHANGE =
  /\b(yes|no|not|guess|maybe|whatever|enroll|compare|ninety|90|three[- ]month|dollar|estimate|lakeview|oak|centerwell|withdraw|please|sure|kind of|sort of|absolutely)\b/i;

export function finalCompatibleWithPartial(partial: string, final: string) {
  const p = partial.trim().replace(/[.!?,;:]+$/g, "").toLowerCase();
  const f = final.trim().replace(/[.!?,;:]+$/g, "").toLowerCase();
  if (!p || !f) return false;
  if (f === p) return true;
  if (!f.startsWith(p)) return false;
  const extra = f.slice(p.length);
  if (/^[\s'!?.,"]*$/.test(extra)) return true;
  if (CLASS_CHANGE.test(extra)) return false;
  return extra.trim().split(/\s+/).filter(Boolean).length <= 3;
}

function lastTurns(session: SessionState) {
  return session.transcript
    .slice(-4)
    .map((t) => `${t.speaker[0]}:${t.stability[0]}:${t.text}`)
    .join(" | ");
}

function parseCsvInterp(text: string) {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const line =
    lines.find((l) => !/^ct\b/i.test(l) && /[RPEGD]|ha|cv|fk/.test(l)) ??
    lines[0] ??
    "";
  const p = line.split(/[\s,|]+/).filter(Boolean);
  const start = p[0] === "ct" ? 1 : 0;
  const at = (i: number) => p[start + i] ?? "-";
  return {
    ct: at(0),
    rf: at(1),
    ha: at(2),
    rt: at(3),
    cr: at(4),
    n90: at(5),
    rh: at(6),
    si: at(7),
    cc: at(8),
    ec: at(9),
    el: at(10),
    em: at(11),
    cv: at(12),
    ma: at(13),
    ao: at(14),
    fr: at(15),
    st: at(16),
    we: at(17),
    qp: at(18),
    qc: at(19),
    qd: at(20),
    pt: at(21),
    fk: at(22),
  };
}

export async function interpretUtterance(
  session: SessionState,
  utterance: { speaker: string; text: string; stability: string },
): Promise<Interpretation> {
  const dynamic = `ct:${session.callType} need:${session.currentNeed} open:${session.needs.map((n) => n.kind[0] + n.status[0]).join(",") || "-"} histQ:${getNeedQuery(session, "historical_price") ? 1 : 0}
turns:${lastTurns(session)}
who:${utterance.speaker} stab:${utterance.stability}
utt:${JSON.stringify(utterance.text)}`;
  const luna = await lunaStream({
    input: `${INTERPRET_STATIC}\n---\n${dynamic}`,
    maxOutputTokens: 48,
  });
  const csv = parseCsvInterp(luna.text);
  const json = luna.text.includes("{")
    ? parseJsonObject<Record<string, unknown>>(luna.text)
    : null;
  const parsed = json ?? {};
  const qpRaw = csv.qp !== "-" ? csv.qp : parsed.qp ?? parsed.quotePharmacy;
  const qdRaw = csv.qd !== "-" ? csv.qd : parsed.qd ?? parsed.quoteDrug;
  const ccRaw = csv.cc !== "-" ? csv.cc : parsed.cc ?? parsed.comparisonConsent;
  const ecRaw = csv.ec !== "-" ? csv.ec : parsed.ec ?? parsed.enrollmentConsent;
  const rfRaw = csv.rf !== "-" ? csv.rf : parsed.rf ?? parsed.refillCheck;
  const ptRaw = csv.pt !== "-" ? csv.pt : parsed.pt ?? parsed.pricingTrigger;
  const fkRaw = csv.fk !== "-" ? csv.fk : parsed.fk ?? parsed.focusKind;
  const ctRaw = csv.ct !== "-" ? csv.ct : parsed.ct ?? parsed.callTypeChange;
  const electedSrc =
    csv.em && csv.em !== "-"
      ? csv.em.split("+")
      : parsed.em ?? parsed.electedMedications;
  const elected = Array.isArray(electedSrc)
    ? electedSrc.filter((x): x is string =>
        DRUGS.includes(x as (typeof DRUGS)[number]),
      )
    : [];
  const callValues = Object.values(CALL);
  let ct: Interpretation["callTypeChange"] =
    typeof ctRaw === "string" && ctRaw in CALL
      ? CALL[ctRaw as keyof typeof CALL]
      : typeof ctRaw === "string" &&
          callValues.includes(ctRaw as (typeof CALL)[keyof typeof CALL])
        ? (ctRaw as Interpretation["callTypeChange"])
        : null;
  if (
    ct === "Do-not-call" &&
    !/\b(do not call|don't call|remove me|stop calling)\b/i.test(utterance.text)
  ) {
    ct = null;
  }
  const qp =
    qpRaw === "l" || qpRaw === "lakeview"
      ? ("lakeview" as const)
      : qpRaw === "o" || qpRaw === "oak-street"
        ? ("oak-street" as const)
        : qpRaw === "c" || qpRaw === "centerwell"
          ? ("centerwell" as const)
          : null;
  const cc =
    ccRaw === "h" || ccRaw === "hedge"
      ? ("hedge" as const)
      : ccRaw === "y" || ccRaw === "absolute_yes"
        ? ("absolute_yes" as const)
        : ("none" as const);
  const ec =
    ecRaw === "h" || ecRaw === "hedge"
      ? ("hedge" as const)
      : ecRaw === "y" || ecRaw === "absolute_yes"
        ? ("absolute_yes" as const)
        : ("none" as const);
  const rf =
    rfRaw === "ex" || rfRaw === "existing_request"
      ? ("existing_request" as const)
      : rfRaw === "rd" || rfRaw === "current_readiness"
        ? ("current_readiness" as const)
        : ("none" as const);
  const pt =
    ptRaw === "p" || ptRaw === "prospective_estimate"
      ? ("prospective_estimate" as const)
      : ptRaw === "h" || ptRaw === "historical_charges"
        ? ("historical_charges" as const)
        : ("none" as const);
  const focusValues = Object.values(FOCUS);
  const fk =
    typeof fkRaw === "string" && fkRaw in FOCUS
      ? FOCUS[fkRaw]
      : typeof fkRaw === "string" && focusValues.includes(fkRaw as NeedKind)
        ? (fkRaw as NeedKind)
        : null;
  return {
    callTypeChange: ct,
    refillCheck: rf,
    historicalAsked:
      on(csv.ha) ||
      on(parsed.ha) ||
      on(parsed.historicalAsked) ||
      fk === "historical_price",
    returnToHistorical: on(csv.rt) || on(parsed.rt) || on(parsed.returnToHistorical),
    communicatedRefillReadiness:
      on(csv.cr) || on(parsed.cr) || on(parsed.communicatedRefillReadiness),
    ninetyDayAsked: on(csv.n90) || on(parsed.n90) || on(parsed.ninetyDayAsked),
    retailHesitation: on(csv.rh) || on(parsed.rh) || on(parsed.retailHesitation),
    serviceIntroducedByAdvocate:
      on(csv.si) || on(parsed.si) || on(parsed.serviceIntroducedByAdvocate),
    comparisonConsent: cc,
    enrollmentConsent: ec,
    electionMetforminOnly: on(csv.el) || on(parsed.el) || on(parsed.electionMetforminOnly),
    electedMedications: elected,
    coverageAsked:
      on(csv.cv) ||
      on(parsed.cv) ||
      on(parsed.coverageAsked) ||
      fk === "coverage_status",
    memberAgreesTransfer: on(csv.ma) || on(parsed.ma) || on(parsed.memberAgreesTransfer),
    advocateOfferedTransfer:
      on(csv.ao) || on(parsed.ao) || on(parsed.advocateOfferedTransfer),
    firmRefusal: on(csv.fr) || on(parsed.fr) || on(parsed.firmRefusal),
    smallTalkOnly: on(csv.st) || on(parsed.st) || on(parsed.smallTalkOnly),
    withdrawEnrollment:
      (on(csv.we) || on(parsed.we) || on(parsed.withdrawEnrollment)) &&
      /\b(withdraw|never mind|don't enroll|do not enroll|changed my mind)\b/i.test(
        utterance.text,
      ),
    quotePharmacy: qp,
    quotePharmacyCorrection:
      on(csv.qc) || on(parsed.qc) || on(parsed.quotePharmacyCorrection),
    quoteDrug:
      typeof qdRaw === "string" &&
      DRUGS.includes(qdRaw as (typeof DRUGS)[number])
        ? qdRaw
        : null,
    pricingTrigger: pt,
    focusKind: fk,
    raw: luna.text,
    ms: luna.ms,
    ttftMs: luna.ttftMs ?? null,
    usage: luna.usage ?? null,
    ok: luna.ok,
  };
}

function getNeedQuery(session: SessionState, kind: string) {
  return session.needs.find((n) => n.kind === kind)?.queryText;
}
