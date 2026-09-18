import { lunaComplete, parseJsonObject } from "@/lib/openai";
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

function bit(v: unknown): boolean {
  return v === 1 || v === true;
}

export async function interpretUtterance(
  session: SessionState,
  utterance: { speaker: string; text: string; stability: string },
): Promise<Interpretation> {
  const luna = await lunaComplete(
    `Classify one utterance. JSON only. No prose. No rationale. Keys:
ct:null|R|P|E|D|G rf:n|ex|rd ha,rt,cr,n90,rh,si,el,cv,ma,ao,fr,st,we,qc:0|1 cc,ec:n|h|y em:[] qp:null|l|o|c qd:null|metformin|atorvastatin|jardiance pt:n|h|p fk:null|rs|hp|pc|se|sel|cs

Rules:
- Historical price stays inside Refill; do not change ct for a focus change.
- ct=E only if advocate introduces optional 90-day/delivery/pharmacy service, or member asks how that option works.
- rf=ex already-submitted refill; rf=rd ready today.
- st=1 only harmless small talk with no servicing ask.
- ha=1 completed past charges (different amounts on different days counts). rt=1 return to a deferred price question.
- n90=1 ask how a 90-day/ninety-day/three-month option works. n90=0 for ran-out / already-on-90-day / a price or estimate at a named pharmacy (use qp/qd).
- rh=1 uncertainty about delivery plus keep speaking with retail pharmacist. fr=1 explicit keep-retail/no-delivery.
- si=1 advocate introduces the optional service.
- cc=h hedged compare reply; cc=y clear yes to a scoped compare question. Hearing prices is not enrollment.
- qp/qd REQUIRED when the member asks a prospective estimate at a named pharmacy (l=lakeview, o=oak-street, c=centerwell). qc=1 pharmacy correction.
- el=1 split election; em=delivery drugs from {metformin,atorvastatin} only.
- ec=y clear yes after scoped enrollment readback. we=1 withdraw.
- cv=1 pending coverage-status ask. ao=1 advocate offers Coverage Review. ma=1 member agrees to that connection.
- pt=p future fill estimate spoken as estimate; pt=h completed past charges; else n.

Shots (invented; not test streams):
{"rf":"ex"} refill I already submitted
{"rf":"rd"} ready if I drive over today
{"ha":1} last fill eleven at one store forty at another
{"rt":1} back to that cost question
{"n90":1} walk me through the ninety-day mail option
{"rh":1} unsure about mail; like the counter conversation
{"fr":1} keep retail; do not set up delivery
{"cc":"h"} yeah I guess sure after a compare ask
{"cc":"y"} yes I want you to compare both pharmacies she named
{"qp":"l","qd":"metformin"} 90-day estimate at the first retail pharmacy she named for the blood-pressure tablet
{"qc":1,"qp":"o"} not that first retail pharmacy — the other retail location she listed
{"el":1,"em":["metformin"]} leave cholesterol at the counter; delivery for the blood-pressure tablet only
{"ec":"y"} yes for the one we just scoped
{"we":1} please withdraw that enrollment
{"cv":1} has the pending request for that SGLT2 been approved

Omit fields that are default n/0/null.
Call type: ${session.callType}
Need: ${session.currentNeed}
Open: ${session.needs.map((n) => n.kind + ":" + n.status).join(",") || "none"}
HistQ: ${Boolean(getNeedQuery(session, "historical_price"))}
Who: ${utterance.speaker}
Stab: ${utterance.stability}
Utt: ${JSON.stringify(utterance.text)}`,
    128,
  );
  const parsed = (parseJsonObject<Record<string, unknown>>(luna.text) ??
    {}) as Record<string, unknown>;
  const qpRaw = parsed.qp ?? parsed.quotePharmacy;
  const qdRaw = parsed.qd ?? parsed.quoteDrug;
  const ccRaw = parsed.cc ?? parsed.comparisonConsent;
  const ecRaw = parsed.ec ?? parsed.enrollmentConsent;
  const rfRaw = parsed.rf ?? parsed.refillCheck;
  const ptRaw = parsed.pt ?? parsed.pricingTrigger;
  const fkRaw = parsed.fk ?? parsed.focusKind;
  const ctRaw = parsed.ct ?? parsed.callTypeChange;
  const electedSrc = parsed.em ?? parsed.electedMedications;
  const elected = Array.isArray(electedSrc)
    ? electedSrc.filter((x): x is string =>
        DRUGS.includes(x as (typeof DRUGS)[number]),
      )
    : [];
  const callValues = Object.values(CALL);
  const ct =
    typeof ctRaw === "string" && ctRaw in CALL
      ? CALL[ctRaw as keyof typeof CALL]
      : typeof ctRaw === "string" && callValues.includes(ctRaw as (typeof CALL)[keyof typeof CALL])
        ? (ctRaw as Interpretation["callTypeChange"])
        : null;
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
    historicalAsked: bit(parsed.ha) || bit(parsed.historicalAsked),
    returnToHistorical: bit(parsed.rt) || bit(parsed.returnToHistorical),
    communicatedRefillReadiness:
      bit(parsed.cr) || bit(parsed.communicatedRefillReadiness),
    ninetyDayAsked: bit(parsed.n90) || bit(parsed.ninetyDayAsked),
    retailHesitation: bit(parsed.rh) || bit(parsed.retailHesitation),
    serviceIntroducedByAdvocate:
      bit(parsed.si) || bit(parsed.serviceIntroducedByAdvocate),
    comparisonConsent: cc,
    enrollmentConsent: ec,
    electionMetforminOnly: bit(parsed.el) || bit(parsed.electionMetforminOnly),
    electedMedications: elected,
    coverageAsked: bit(parsed.cv) || bit(parsed.coverageAsked),
    memberAgreesTransfer: bit(parsed.ma) || bit(parsed.memberAgreesTransfer),
    advocateOfferedTransfer:
      bit(parsed.ao) || bit(parsed.advocateOfferedTransfer),
    firmRefusal: bit(parsed.fr) || bit(parsed.firmRefusal),
    smallTalkOnly: bit(parsed.st) || bit(parsed.smallTalkOnly),
    withdrawEnrollment: bit(parsed.we) || bit(parsed.withdrawEnrollment),
    quotePharmacy: qp,
    quotePharmacyCorrection:
      bit(parsed.qc) || bit(parsed.quotePharmacyCorrection),
    quoteDrug:
      typeof qdRaw === "string" &&
      DRUGS.includes(qdRaw as (typeof DRUGS)[number])
        ? qdRaw
        : null,
    pricingTrigger: pt,
    focusKind: fk,
    raw: luna.text,
    ms: luna.ms,
    ok: luna.ok,
  };
}

function getNeedQuery(session: SessionState, kind: string) {
  return session.needs.find((n) => n.kind === kind)?.queryText;
}
