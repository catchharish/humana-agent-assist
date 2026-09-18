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

const INTERPRET_STATIC = `Classify one utterance. JSON object only, no prose. Keys: ct rf ha rt cr n90 rh si cc ec el em cv ma ao fr st we qp qc qd pt fk
Allowed: ct R|P|E|D|G|- ; rf n|ex|rd ; bits 0 or 1 ; cc ec n|h|y ; em [] ; qp -|l|o|c ; qd - or named drug from Entities ; pt n|h|p ; fk -|rs|hp|pc|se|sel|cs
Rules: hist price stays R. D only if they ask not to be called. E only if advocate introduces 90-day/delivery or member asks how it works. rf=ex already-submitted refill; rd ready today. st=1 small talk only. ha=1 question about past paid amounts (then fk=hp). rt=1 return to deferred price. n90=1 how 90-day option works. rh=1 unsure delivery while keeping retail. fr=1 keep retail/no delivery. si=1 advocate introduces service. cc=h hedge; cc=y clear yes to scoped compare. qp/qd for named-pharmacy estimate. qc=1 pharmacy correction. el=1 split election; em delivery drugs. ec=y yes after scoped readback. we=1 withdraw. cv=1 pending coverage/approval status (then fk=cs). ao=1 advocate offers Coverage Review. ma=1 member agrees to transfer. pt=p future estimate; pt=h past charges.
Shots (invented layout only; input then object):
paid-last-April-at-other-counter → {"ct":"R","rf":"n","ha":1,"rt":0,"cr":0,"n90":0,"rh":0,"si":0,"cc":"n","ec":"n","el":0,"em":[],"cv":0,"ma":0,"ao":0,"fr":0,"st":0,"we":0,"qp":"-","qc":0,"qd":"-","pt":"n","fk":"hp"}
has-that-new-card-been-reviewed → {"ct":"G","rf":"n","ha":0,"rt":0,"cr":0,"n90":0,"rh":0,"si":0,"cc":"n","ec":"n","el":0,"em":[],"cv":1,"ma":0,"ao":0,"fr":0,"st":0,"we":0,"qp":"-","qc":0,"qd":"-","pt":"n","fk":"cs"}
how-does-the-mail-option-work → {"ct":"E","rf":"n","ha":0,"rt":0,"cr":0,"n90":1,"rh":0,"si":0,"cc":"n","ec":"n","el":0,"em":[],"cv":0,"ma":0,"ao":0,"fr":0,"st":0,"we":0,"qp":"-","qc":0,"qd":"-","pt":"n","fk":"se"}
Cache prefix (ignore): JSON schema reminder. Output one object. Unknown fields stay default n or 0 or -. Never invent drugs. Never mint or submit. Bits are 0 or 1. ${"Follow the schema. One JSON object. Defaults n 0 -. ".repeat(48)}`;

export function finalCompatibleWithPartial(partial: string, final: string) {
  const p = partial.trim().replace(/[.!?,;:]+$/g, "").toLowerCase();
  const f = final.trim().replace(/[.!?,;:]+$/g, "").toLowerCase();
  if (!p || !f) return false;
  if (f === p) return true;
  if (!f.startsWith(p)) return false;
  const extra = f.slice(p.length);
  return /^[\s'!?.,"]*$/.test(extra);
}

function lastTurns(session: SessionState) {
  return session.transcript
    .slice(-4)
    .map((t) => `${t.speaker[0]}:${t.stability[0]}:${t.text}`)
    .join(" | ");
}

const BITS = new Set(["0", "1"]);
const CC = new Set(["n", "h", "y"]);
const RF = new Set(["n", "ex", "rd"]);
const CT = new Set(["R", "P", "E", "D", "G", "-"]);
const QP = new Set(["-", "l", "o", "c"]);
const PT = new Set(["n", "h", "p"]);
const FK = new Set(["-", "rs", "hp", "pc", "se", "sel", "cs"]);

function parseCsvInterp(text: string): Compact | null {
  const json = parseJsonObject<Record<string, unknown>>(text);
  if (json && typeof json === "object") {
    const ct = String(json.ct ?? "-");
    const rf = String(json.rf ?? "n");
    const cc = String(json.cc ?? "n");
    const ec = String(json.ec ?? "n");
    const qp = String(json.qp ?? "-");
    const pt = String(json.pt ?? "n");
    const fk = String(json.fk ?? "-");
    if (!CT.has(ct) || !RF.has(rf) || !CC.has(cc) || !CC.has(ec)) return null;
    if (!QP.has(qp) && qp !== "null") return null;
    if (!PT.has(pt) || !FK.has(fk)) return null;
    return json as Compact;
  }
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const line =
    lines.find((l) => !/^ct\b/i.test(l) && /[RPEGD]/.test(l)) ?? lines[0] ?? "";
  const p = line.split(/[\s,|]+/).filter(Boolean);
  if (p.length !== 23) return null;
  const at = (i: number) => p[i] ?? "-";
  if (!CT.has(at(0)) || !RF.has(at(1))) return null;
  for (const i of [2, 3, 4, 5, 6, 7, 10, 12, 13, 14, 15, 16, 17, 19]) {
    if (!BITS.has(at(i))) return null;
  }
  if (!CC.has(at(8)) || !CC.has(at(9))) return null;
  if (!QP.has(at(18)) || !PT.has(at(21)) || !FK.has(at(22))) return null;
  return {
    ct: at(0) as Compact["ct"],
    rf: at(1) as Compact["rf"],
    ha: Number(at(2)) as 0 | 1,
    rt: Number(at(3)) as 0 | 1,
    cr: Number(at(4)) as 0 | 1,
    n90: Number(at(5)) as 0 | 1,
    rh: Number(at(6)) as 0 | 1,
    si: Number(at(7)) as 0 | 1,
    cc: at(8) as Compact["cc"],
    ec: at(9) as Compact["ec"],
    el: Number(at(10)) as 0 | 1,
    em: at(11) === "-" ? [] : at(11).split("+"),
    cv: Number(at(12)) as 0 | 1,
    ma: Number(at(13)) as 0 | 1,
    ao: Number(at(14)) as 0 | 1,
    fr: Number(at(15)) as 0 | 1,
    st: Number(at(16)) as 0 | 1,
    we: Number(at(17)) as 0 | 1,
    qp: at(18) as Compact["qp"],
    qc: Number(at(19)) as 0 | 1,
    qd: at(20) === "-" ? null : (at(20) as Compact["qd"]),
    pt: at(21) as Compact["pt"],
    fk: at(22) as Compact["fk"],
  };
}

export async function interpretUtterance(
  session: SessionState,
  utterance: { speaker: string; text: string; stability: string },
): Promise<Interpretation> {
  const entities = {
    drugs: [
      ...new Set([
        ...session.quotes.map((q) => q.drugName),
        ...session.enrollment.medications,
      ]),
    ].filter(Boolean),
    pharmacies: [
      ...new Set(session.quotes.map((q) => q.pharmacyName).filter(Boolean)),
    ],
    draft: session.enrollment.medications,
  };
  const dynamic = `ct:${session.callType} need:${session.currentNeed} open:${session.needs.map((n) => n.kind[0] + n.status[0]).join(",") || "-"} histQ:${getNeedQuery(session, "historical_price") ? 1 : 0}
entities:${JSON.stringify(entities)}
turns:${lastTurns(session)}
who:${utterance.speaker} stab:${utterance.stability}
utt:${JSON.stringify(utterance.text)}`;
  const luna = await lunaStream({
    input: `${INTERPRET_STATIC}\n---\n${dynamic}`,
    maxOutputTokens: 160,
    serviceTier: "priority",
    promptCacheKey: "haa-interpret-v3",
    onDelta: (acc) => Boolean(parseCsvInterp(acc)),
  });
  const csv = parseCsvInterp(luna.text);
  if (!csv) {
    return {
      callTypeChange: null,
      refillCheck: "none",
      historicalAsked: false,
      returnToHistorical: false,
      communicatedRefillReadiness: false,
      ninetyDayAsked: false,
      retailHesitation: false,
      serviceIntroducedByAdvocate: false,
      comparisonConsent: "none",
      enrollmentConsent: "none",
      electionMetforminOnly: false,
      electedMedications: [],
      coverageAsked: false,
      memberAgreesTransfer: false,
      advocateOfferedTransfer: false,
      firmRefusal: false,
      smallTalkOnly: false,
      withdrawEnrollment: false,
      quotePharmacy: null,
      quotePharmacyCorrection: false,
      quoteDrug: null,
      pricingTrigger: "none",
      focusKind: null,
      raw: luna.text,
      ms: luna.ms,
      ttftMs: luna.ttftMs ?? null,
      usage: luna.usage ?? null,
      ok: false,
    };
  }
  const qpRaw = String(csv.qp ?? "-");
  const qdRaw = csv.qd;
  const ccRaw = String(csv.cc ?? "n");
  const ecRaw = String(csv.ec ?? "n");
  const rfRaw = String(csv.rf ?? "n");
  const ptRaw = String(csv.pt ?? "n");
  const fkRaw = csv.fk;
  const ctRaw = csv.ct;
  const electedSrc = Array.isArray(csv.em)
    ? csv.em
    : typeof csv.em === "string" && csv.em !== "-"
      ? String(csv.em).split("+")
      : [];
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
      fk === "historical_price",
    returnToHistorical: on(csv.rt),
    communicatedRefillReadiness: on(csv.cr),
    ninetyDayAsked: on(csv.n90),
    retailHesitation: on(csv.rh),
    serviceIntroducedByAdvocate: on(csv.si),
    comparisonConsent: cc,
    enrollmentConsent: ec,
    electionMetforminOnly: on(csv.el),
    electedMedications: elected,
    coverageAsked: on(csv.cv) || fk === "coverage_status",
    memberAgreesTransfer: on(csv.ma),
    advocateOfferedTransfer: on(csv.ao),
    firmRefusal: on(csv.fr),
    smallTalkOnly: on(csv.st),
    withdrawEnrollment:
      on(csv.we) &&
      /\b(withdraw|never mind|don't enroll|do not enroll|changed my mind)\b/i.test(
        utterance.text,
      ),
    quotePharmacy: qp,
    quotePharmacyCorrection: on(csv.qc),
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
