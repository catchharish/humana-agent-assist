/**
 * Next-best-action: model proposes from playbooks; hard stops stay in code.
 */
import { appendJsonl } from "@/lib/log";
import { parseJsonObject, terraComplete } from "@/lib/openai";
import { requiredPricingOnNow } from "@/lib/session";
import type { Recommendation, SessionState } from "@/lib/types";
import type { CitedStatement } from "@/lib/citations";
import {
  confirmedTokens,
  draftFactTokens,
} from "@/lib/supportCheck";

export type NbaStop =
  | "unverified"
  | "due_now"
  | "already_enrolled"
  | "said_no"
  | "do_not_contact"
  | "dismissed_this_call"
  | "unconfirmed_fact";

export type NbaConsidered = { action: string; whyNot: string };

export type NbaDraft = {
  action: string;
  title: string;
  body: string;
  reasons: string[];
  facts: string[];
  playbookIds: string[];
  considered: NbaConsidered[];
  preferredVsMail: string;
  advocateControl: "offer_dismiss" | "confirm_transfer";
  marksPricingUpcoming: boolean;
  playbookPassage?: string;
  pillName?: string;
};

export type NbaFailed = {
  failed: true;
  status: string;
  detail?: string;
};

export type NbaDraftResult = NbaDraft | NbaFailed;

export function isNbaFailed(
  value: NbaDraftResult | null | undefined,
): value is NbaFailed {
  return Boolean(value && typeof value === "object" && "failed" in value && value.failed);
}

const FORBIDDEN_ACTION = /^(enroll|coverage_decision|take_payment|clinical)/i;

export function playbookMeta(text: string): {
  actionId: string;
  advocateControl: "offer_dismiss" | "confirm_transfer";
  marksPricingUpcoming: boolean;
  pillName: string;
} {
  const actionId = (/Action id:\s*([a-z0-9_]+)/i.exec(text)?.[1] ?? "").toLowerCase();
  const control = /Advocate control:\s*(offer_dismiss|confirm_transfer)/i.exec(
    text,
  )?.[1] as "offer_dismiss" | "confirm_transfer" | undefined;
  const pillName = (/Pill name:\s*([^\n.]+)/i.exec(text)?.[1] ?? "").trim();
  return {
    actionId,
    advocateControl: control ?? "offer_dismiss",
    marksPricingUpcoming: /Marks pricing upcoming:\s*yes/i.test(text),
    pillName,
  };
}

export function nbaRecordsInput(session: SessionState) {
  const claims = (session.prefetch?.claims ?? []) as Array<
    Record<string, unknown>
  >;
  const network = (session.prefetch?.classifications ?? []) as Array<
    Record<string, unknown>
  >;
  return {
    paidClaims: claims.map((c) => ({
      date: c.dateOfService,
      drug: c.drugName,
      pharmacy: c.pharmacy ?? c.pharmacyName,
      memberPaid: c.memberPaidAmount,
    })),
    pharmacyNetwork: network.map((n) => ({
      date: n.asOfDate,
      pharmacy: n.pharmacyName,
      tier: n.networkTier,
    })),
    mailServiceEnrolled: Boolean(
      session.prefetch?.contactPreferences?.mailServiceEnrolled,
    ),
    doNotContact: Boolean(session.prefetch?.contactPreferences?.doNotContact),
    saidNoThisCall: session.optionalWorkSuppressed,
  };
}

/** Record rows already fetched this session, as support-checkable facts. */
export function recordFactsAsStatements(session: SessionState): CitedStatement[] {
  const recs = nbaRecordsInput(session);
  const out: CitedStatement[] = [];
  for (const c of recs.paidClaims) {
    if (!c.date || !c.memberPaid || !c.pharmacy) continue;
    const paid =
      typeof c.memberPaid === "object" && c.memberPaid && "value" in c.memberPaid
        ? String((c.memberPaid as { value?: string }).value)
        : String(c.memberPaid);
    const pharmacy =
      typeof c.pharmacy === "object" && c.pharmacy && "name" in c.pharmacy
        ? String((c.pharmacy as { name?: string }).name)
        : String(c.pharmacy);
    out.push({
      text: `On ${c.date} he paid $${paid} for ${c.drug} at ${pharmacy}.`,
      sourceId: "record-claim",
      sourceTag: "Claims",
      confirmed: true,
    });
  }
  for (const n of recs.pharmacyNetwork) {
    if (!n.date || !n.pharmacy || !n.tier) continue;
    out.push({
      text: `${n.pharmacy} was classified as ${String(n.tier).replace(/_/g, " ")} on ${n.date}.`,
      sourceId: "record-network",
      sourceTag: "Plan rules",
      confirmed: true,
    });
  }
  return out;
}

export function sessionStatements(session: SessionState): CitedStatement[] {
  const fromNeeds = session.needs.flatMap((n) => n.answer?.statements ?? []);
  const fromNow = session.nowCard.statements ?? [];
  const fromRecords = recordFactsAsStatements(session);
  const seen = new Set<string>();
  const out: CitedStatement[] = [];
  for (const s of [...fromNow, ...fromNeeds, ...fromRecords]) {
    const key = `${s.sourceId}|${s.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function nbaHardStop(
  session: SessionState,
  draft?: NbaDraft | null,
): {
  stop: NbaStop | null;
  detail: string;
} {
  if (session.identityStatus !== "VALID") {
    return { stop: "unverified", detail: "identity not verified" };
  }
  if (requiredPricingOnNow(session)) {
    return { stop: "due_now", detail: "required statement due now" };
  }
  const prefs = session.prefetch?.contactPreferences;
  if (prefs?.doNotContact) {
    return { stop: "do_not_contact", detail: "member asked not to be contacted" };
  }
  if (prefs?.mailServiceEnrolled) {
    return { stop: "already_enrolled", detail: "already enrolled in mail service" };
  }
  if (session.optionalWorkSuppressed) {
    return { stop: "said_no", detail: "already said no on this call" };
  }
  if (session.nbaDismissedThisCall || session.recommendation?.status === "dismissed") {
    return { stop: "dismissed_this_call", detail: "already dismissed on this call" };
  }
  if (draft && draft.action !== "none") {
    const statements = sessionStatements(session);
    const conf = new Set(confirmedTokens(statements));
    const used = draftFactTokens([
      ...(draft.reasons ?? []),
      ...(draft.facts ?? []),
    ]);
    const hit = used.find((tok) => !conf.has(tok));
    if (hit) {
      return {
        stop: "unconfirmed_fact",
        detail: hit,
      };
    }
  }
  return { stop: null, detail: "" };
}

export function logNbaAttempt(
  session: SessionState,
  rec: Record<string, unknown>,
) {
  session.diagnostics.nba = [...session.diagnostics.nba, rec].slice(-20);
  appendJsonl(session.sessionId, { kind: "nba", ...rec });
}

export async function draftNbaFromPlaybook(args: {
  origin: string;
  authId: string;
  snapshot: string;
  question: string;
  conversation: string;
  planId: string;
  needsSupport?: string;
  serviceTier?: "priority" | "fast";
}): Promise<NbaDraftResult> {
  const search = await fetch(
    `${args.origin}/api/simulated/scripting/knowledge/search`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-authorization-id": args.authId,
      },
      body: "{}",
    },
  );
  const json = (await search.json()) as {
    data?: {
      candidates?: Array<{
        id: string;
        kind?: string;
        text: string;
        planId?: string | null;
      }>;
    };
  };
  const playbooks = (json.data?.candidates ?? []).filter(
    (c) =>
      c.kind === "playbook" && (!c.planId || c.planId === args.planId),
  );
  const uniqueIds = [
    ...new Set([
      "none",
      ...playbooks.map((p) => playbookMeta(p.text).actionId).filter(Boolean),
    ]),
  ];
  const terra = await terraComplete(
    `INFORMATION ONLY. Propose at most one next action for the advocate, or none.
You cannot enroll, determine coverage, take payment, or give clinical advice.
Do not mention prospective dollar amounts.
Use only the session member's plan and records, not another member.
Hard stops (identity, due-now wording, enrolled, said no, DNC, dismissed, unconfirmed fact) are applied in code after you answer — still reason as if you must justify none vs an offer.
Action ids come only from the playbooks below (plus none). Do not invent ids.
If a listed playbook has Action id none and the confirmed member facts match that playbook, action must be none. Do not invent a comparison, transfer, or courtesy offer that playbook forbids.
Return JSON only:
{"action":string,"title":string,"body":string,"reasons":string[],"facts":string[],"playbookIds":string[],"considered":[{"action":string,"whyNot":string}],"preferredVsMail":string}
body is required when action is not none: the one or two sentences the advocate can say now. When the action is a pharmacy comparison or a preferred-pharmacy tip, body must name the confirmed pharmacies and which was preferred versus standard. Do not leave body empty and do not put the tip only in facts.
action must be one of: ${uniqueIds.join(", ")}
considered must list every other action you thought about and why you rejected it.
preferredVsMail: if this member has a preferred-retail vs standard-retail gap AND a mail-order comparison could also apply, say which you chose and why. Otherwise "".
Do not copy another member's amounts.
Each reasons item must name the member fact it rests on.
A suggestion's reasons and facts may use only facts listed under confirmedThisCall (support check confirmed this call). Do not use dropped facts. recordsFetchedThisCall shows claims, network rows, and mail / said-no flags so you can see preferred vs standard paid amounts and whether mail is in use — treat a claim or pharmacy name as usable in reasons/facts only when that same value is also under confirmedThisCall. Mail enrollment, do-not-contact, and said-no flags may be used from recordsFetchedThisCall. Conversation without those values is allowed.

Playbooks:
${playbooks.map((p) => `${p.id}: ${p.text}`).join("\n")}

Member snapshot:
${args.snapshot}

Needs (resolved and unresolved) and support-check results:
${args.needsSupport ?? "(none yet)"}

Recent conversation:
${args.conversation}

Current member question:
${args.question}`,
    520,
  );
  if (!terra.ok) {
    return {
      failed: true,
      status: String(terra.httpStatus || "model_error"),
      detail: terra.error ?? "model_error",
    };
  }
  const parsed = parseJsonObject<NbaDraft>(terra.text);
  const action = String(parsed?.action ?? "").toLowerCase();
  if (
    !parsed ||
    !action ||
    FORBIDDEN_ACTION.test(action) ||
    !uniqueIds.includes(action)
  ) {
    return {
      failed: true,
      status: "unparsed",
      detail: action ? `invalid_action:${action}` : "unparsed",
    };
  }
  const considered = Array.isArray(parsed.considered)
    ? parsed.considered.map((c) => ({
        action: String((c as NbaConsidered).action ?? ""),
        whyNot: String((c as NbaConsidered).whyNot ?? ""),
      }))
    : [];
  const fromPlaybook = playbooks.find(
    (p) => playbookMeta(p.text).actionId === action,
  );
  const meta = fromPlaybook
    ? playbookMeta(fromPlaybook.text)
    : {
        actionId: action,
        advocateControl: "offer_dismiss" as const,
        marksPricingUpcoming: false,
        pillName: "",
      };
  return {
    action,
    title: String(parsed.title ?? ""),
    body: String(parsed.body ?? ""),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
    facts: Array.isArray(parsed.facts) ? parsed.facts.map(String) : [],
    playbookIds: Array.isArray(parsed.playbookIds)
      ? parsed.playbookIds.map(String)
      : fromPlaybook
        ? [fromPlaybook.id]
        : [],
    considered,
    preferredVsMail: String(parsed.preferredVsMail ?? ""),
    advocateControl: meta.advocateControl,
    marksPricingUpcoming: meta.marksPricingUpcoming,
    playbookPassage: fromPlaybook?.text,
    pillName: meta.pillName,
  };
}

function recRank(kind: string) {
  if (kind === "warm_transfer") return 3;
  if (kind === "objection_retail") return 2;
  return 1;
}

function recFromDraft(draft: NbaDraft): Recommendation {
  return {
    kind: draft.action,
    title: draft.title || "Suggested next step",
    body: draft.body,
    reasons: draft.reasons,
    facts: draft.facts,
    playbookIds: draft.playbookIds,
    considered: draft.considered,
    preferredVsMail: draft.preferredVsMail,
    advocateControl: draft.advocateControl,
    marksPricingUpcoming: draft.marksPricingUpcoming,
    sourceLabel: draft.playbookIds[0]
      ? `Playbook · ${draft.playbookIds[0]}`
      : "Playbook",
    playbookPassage: draft.playbookPassage,
    pillName: draft.pillName,
    status: "pending",
  };
}

/** One rec on the seat; extras wait. Higher-rank kinds sit in front. */
export function seatRecommendation(
  session: SessionState,
  rec: Recommendation,
) {
  const pending = [
    session.recommendation?.status === "pending"
      ? session.recommendation
      : null,
    ...(session.waitingRecommendations ?? []),
    rec,
  ].filter((row): row is Recommendation => Boolean(row));
  pending.sort((a, b) => recRank(b.kind) - recRank(a.kind));
  // One pending card per action kind — re-seating the same tip must not stack.
  const seen = new Set<string>();
  const unique: Recommendation[] = [];
  for (const row of pending) {
    if (seen.has(row.kind)) continue;
    seen.add(row.kind);
    unique.push(row);
  }
  session.recommendation = unique[0] ?? rec;
  session.waitingRecommendations = unique.slice(1);
}

export function promoteNextRecommendation(session: SessionState) {
  const next = (session.waitingRecommendations ?? []).shift();
  if (next) session.recommendation = next;
}

/** Bring a waiting tip onto the seat (Up next click). */
export function promoteRecommendationKind(session: SessionState, kind: string) {
  const seated =
    session.recommendation?.status === "pending" ? session.recommendation : null;
  const waiting = session.waitingRecommendations ?? [];
  const chosen =
    seated?.kind === kind
      ? seated
      : waiting.find((row) => row.kind === kind && row.status === "pending");
  if (!chosen) return false;
  const rest = [seated, ...waiting].filter(
    (row): row is Recommendation =>
      Boolean(row) && row!.status === "pending" && row!.kind !== kind,
  );
  session.recommendation = chosen;
  session.waitingRecommendations = rest;
  return true;
}

export function applyNbaAfterAnswer(
  session: SessionState,
  draft: NbaDraft | null,
) {
  const gate = nbaHardStop(session, draft);
  if (gate.stop) {
    logNbaAttempt(session, {
      at: new Date().toISOString(),
      event: "hard_stop",
      stop: gate.stop,
      detail: gate.detail,
      fact: gate.stop === "unconfirmed_fact" ? gate.detail : undefined,
      proposal: draft?.action ?? null,
      reasons: draft?.reasons ?? [],
      facts: draft?.facts ?? [],
    });
    return;
  }
  if (!draft || draft.action === "none") {
    logNbaAttempt(session, {
      at: new Date().toISOString(),
      event: "proposal",
      action: "none",
      source: "model",
      reasons: draft?.reasons ?? ["model_none"],
      facts: draft?.facts ?? [],
      playbookIds: draft?.playbookIds ?? [],
      considered: draft?.considered ?? [],
      preferredVsMail: draft?.preferredVsMail ?? "",
    });
    return;
  }
  const rec = recFromDraft(draft);
  const queuedBehind = Boolean(session.recommendation?.status === "pending");
  seatRecommendation(session, rec);
  if (draft.playbookPassage && draft.playbookIds[0]) {
    session.retrievedSources = [
      ...session.retrievedSources,
      {
        id: draft.playbookIds[0],
        kind: "playbook",
        sourceTag: "Playbook",
        text: draft.playbookPassage,
      },
    ];
  }
  logNbaAttempt(session, {
    at: new Date().toISOString(),
    event: queuedBehind ? "queued" : "proposal",
    action: draft.action,
    source: "model",
    title: rec.title,
    reasons: draft.reasons,
    facts: draft.facts,
    playbookIds: draft.playbookIds,
    considered: draft.considered,
    preferredVsMail: draft.preferredVsMail,
    seated: session.recommendation?.kind,
  });
}

export async function proposeNba(
  session: SessionState,
  origin: string,
  question: string,
) {
  try {
    const gate = nbaHardStop(session);
    if (gate.stop) {
      applyNbaAfterAnswer(session, null);
      return;
    }
  const snapshot = [
    `member ${session.member?.memberId} plan ${session.member?.planId}`,
    JSON.stringify(session.prefetch?.contactPreferences ?? {}),
    JSON.stringify(session.prefetch?.claims ?? []),
    JSON.stringify(session.coverage ?? null),
    JSON.stringify({
      needs: session.needs.map((n) => ({
        kind: n.kind,
        status: n.status,
        support: (n.answer?.statements ?? []).map((s) => ({
          text: s.text,
          confirmed: s.confirmed,
          sourceId: s.sourceId,
        })),
      })),
      nowSupport: (session.nowCard.statements ?? []).map((s) => ({
        text: s.text,
        confirmed: s.confirmed,
        sourceId: s.sourceId,
      })),
    }),
  ].join("\n");
  const conversation = session.transcript
    .slice(-8)
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");
  const draft = await draftNbaFromPlaybook({
    origin,
    authId: session.auth?.authorizationId ?? "",
    snapshot,
    question,
    conversation,
    planId: session.member?.planId ?? "",
    needsSupport: JSON.stringify({
      needs: session.needs.map((n) => ({
        kind: n.kind,
        status: n.status,
        support: (n.answer?.statements ?? []).map((s) => ({
          text: s.text,
          confirmed: s.confirmed,
          sourceId: s.sourceId,
        })),
      })),
      confirmedThisCall: sessionStatements(session)
        .filter((s) => s.confirmed)
        .map((s) => ({ text: s.text, sourceId: s.sourceId })),
      droppedThisCall: sessionStatements(session)
        .filter((s) => !s.confirmed)
        .map((s) => ({ text: s.text, sourceId: s.sourceId })),
      recordsFetchedThisCall: nbaRecordsInput(session),
    }),
  });
  if (isNbaFailed(draft)) {
    logNbaAttempt(session, {
      at: new Date().toISOString(),
      event: "failed",
      status: draft.status,
      detail: draft.detail ?? null,
      question,
    });
    return;
  }
  applyNbaAfterAnswer(session, draft);
  } catch (err) {
    logNbaAttempt(session, {
      at: new Date().toISOString(),
      event: "failed",
      status: "nba_exception",
      detail: String(err),
      question,
    });
  }
}

export function logNbaAdvocate(
  session: SessionState,
  decision: "offer" | "dismiss" | "used",
) {
  logNbaAttempt(session, {
    at: new Date().toISOString(),
    event: "advocate",
    decision,
    kind: session.recommendation?.kind ?? null,
  });
}
