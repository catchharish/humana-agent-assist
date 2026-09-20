/**
 * Next-best-action: model proposes from playbooks; hard stops stay in code.
 */
import { appendJsonl } from "@/lib/log";
import { parseJsonObject, terraComplete } from "@/lib/openai";
import { requiredPricingOnNow } from "@/lib/session";
import type { SessionState } from "@/lib/types";
import type { CitedStatement } from "@/lib/citations";
import {
  confirmedTokens,
  unconfirmedTokens,
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
};

const FORBIDDEN_ACTION = /^(enroll|coverage_decision|take_payment|clinical)/i;

export function playbookMeta(text: string): {
  actionId: string;
  advocateControl: "offer_dismiss" | "confirm_transfer";
  marksPricingUpcoming: boolean;
} {
  const actionId = (/Action id:\s*([a-z0-9_]+)/i.exec(text)?.[1] ?? "").toLowerCase();
  const control = /Advocate control:\s*(offer_dismiss|confirm_transfer)/i.exec(
    text,
  )?.[1] as "offer_dismiss" | "confirm_transfer" | undefined;
  return {
    actionId,
    advocateControl: control ?? "offer_dismiss",
    marksPricingUpcoming: /Marks pricing upcoming:\s*yes/i.test(text),
  };
}

function emptyDraft(reasons: string[]): NbaDraft {
  return {
    action: "none",
    title: "",
    body: "",
    reasons,
    facts: [],
    playbookIds: [],
    considered: [],
    preferredVsMail: "",
    advocateControl: "offer_dismiss",
    marksPricingUpcoming: false,
  };
}

export function sessionStatements(session: SessionState): CitedStatement[] {
  const fromNeeds = session.needs.flatMap((n) => n.answer?.statements ?? []);
  const fromNow = session.nowCard.statements ?? [];
  return [...fromNow, ...fromNeeds];
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
    const unconf = unconfirmedTokens(statements);
    const conf = new Set(confirmedTokens(statements));
    const blob = [draft.body, ...(draft.reasons ?? []), ...(draft.facts ?? [])]
      .join(" ")
      .toLowerCase();
    const hit = unconf.find(
      (tok) => tok.length > 3 && !conf.has(tok) && blob.includes(tok),
    );
    if (hit) {
      return {
        stop: "unconfirmed_fact",
        detail: hit,
      };
    }
  }
  return { stop: null, detail: "" };
}

function logNba(session: SessionState, rec: Record<string, unknown>) {
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
}): Promise<NbaDraft> {
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
Return JSON only:
{"action":string,"title":string,"body":string,"reasons":string[],"facts":string[],"playbookIds":string[],"considered":[{"action":string,"whyNot":string}],"preferredVsMail":string}
action must be one of: ${uniqueIds.join(", ")}
considered must list every other action you thought about and why you rejected it.
preferredVsMail: if this member has a preferred-retail vs standard-retail gap AND a mail-order comparison could also apply, say which you chose and why. Otherwise "".
Do not copy another member's amounts.
Each reasons item must name the member fact it rests on. Do not use a fact the support list marks as not confirmed.

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
  if (!terra.ok) return emptyDraft(["model_error"]);
  const parsed = parseJsonObject<NbaDraft>(terra.text);
  const action = String(parsed?.action ?? "").toLowerCase();
  if (
    !parsed ||
    !action ||
    FORBIDDEN_ACTION.test(action) ||
    !uniqueIds.includes(action)
  ) {
    return emptyDraft(["unparsed"]);
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
  };
}

export function applyNbaAfterAnswer(
  session: SessionState,
  draft: NbaDraft | null,
) {
  const gate = nbaHardStop(session, draft);
  if (gate.stop) {
    logNba(session, {
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
    logNba(session, {
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
  if (session.recommendation?.status === "pending") {
    logNba(session, {
      at: new Date().toISOString(),
      event: "held",
      reason: "one_pending_already",
      proposal: draft.action,
    });
    return;
  }
  session.recommendation = {
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
    status: "pending",
  };
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
  logNba(session, {
    at: new Date().toISOString(),
    event: "proposal",
    action: draft.action,
    source: "model",
    title: session.recommendation.title,
    reasons: draft.reasons,
    facts: draft.facts,
    playbookIds: draft.playbookIds,
    considered: draft.considered,
    preferredVsMail: draft.preferredVsMail,
  });
}

export async function proposeNba(
  session: SessionState,
  origin: string,
  question: string,
) {
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
        support: n.answer?.statements ?? [],
      })),
    }),
  });
  applyNbaAfterAnswer(session, draft);
}

export function logNbaAdvocate(
  session: SessionState,
  decision: "offer" | "dismiss" | "used",
) {
  logNba(session, {
    at: new Date().toISOString(),
    event: "advocate",
    decision,
    kind: session.recommendation?.kind ?? null,
  });
}
