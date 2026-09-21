/**
 * 109-item eval runner. Drives the live session APIs only.
 * Does not import answer-loop / NBA code. Does not change application code.
 *
 *   npx tsx scripts/eval_runner.ts
 *   npx tsx scripts/eval_runner.ts --runs=1 --origin=http://127.0.0.1:3000
 *   npx tsx scripts/eval_runner.ts --ids=a01,n01 --resume
 */
import { createHash } from "crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";

const ROOT = process.cwd();
const ORIGIN = env("ORIGIN") ?? arg("origin") ?? "http://127.0.0.1:3000";
const SET_PATH =
  arg("set") ?? path.join(ROOT, "tests", "eval_set_v1.json");
const RUNS = Math.max(1, Number(arg("runs") ?? "1"));
const ONLY = new Set(
  (arg("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const RESUME = process.argv.includes("--resume");
const ANSWER_WAIT_MS = Number(arg("wait") ?? "75000");
const QUIET_WAIT_MS = Number(arg("quiet-wait") ?? "10000");
const JUDGE_MODEL = env("EVAL_JUDGE_MODEL") ?? "gpt-5.6-sol";

type SetupStep =
  | { speaker: "member" | "advocate"; text: string }
  | { wait_for_card: true }
  | { human: string; body?: Record<string, unknown> };

type NbaExpect = {
  action_any_of?: string[];
  action_not?: string[];
  no_dollar_on_card?: boolean;
  needs_reasons?: boolean;
  no_card?: boolean;
  no_new_card?: boolean;
  max_cards?: number;
  stop?: string;
  stop_absent?: string;
};

type Mutation = {
  file: string;
  where?: Record<string, unknown>;
  set?: Record<string, unknown>;
  remove_where?: Record<string, unknown>;
  append?: unknown;
  replace_in?: Record<string, [string, string] | string[]>;
};

type EvalItem = {
  id: string;
  group: string;
  member: string;
  utterance: string;
  expected_outcome: string;
  kind?: string;
  lookups?: string[];
  must_include?: string[][];
  must_not?: string[];
  judge?: string;
  nba?: NbaExpect;
  setup?: SetupStep[];
  auth?: boolean;
  silence_ok?: boolean;
  state_checks?: Record<string, boolean>;
  mutations?: Mutation[];
  known_issue?: string;
  decision_needed?: string;
  paraphrase_of?: string;
  baseline?: string;
};

type EvalSet = {
  version: number;
  built_from_commit?: string;
  members?: Record<string, string>;
  items: EvalItem[];
};

type SessionSnap = {
  sessionId: string;
  identityStatus?: string;
  nowCard?: {
    title?: string;
    body?: string;
    headline?: string;
    statements?: Array<{ text?: string }>;
    retryCause?: string | null;
  };
  needs?: Array<{
    kind?: string;
    answer?: { body?: string; statements?: Array<{ text?: string }> };
  }>;
  recommendation?: {
    kind?: string;
    title?: string;
    body?: string;
    reasons?: string[];
    facts?: string[];
    status?: string;
  } | null;
  waitingRecommendations?: Array<{
    kind?: string;
    title?: string;
    body?: string;
    reasons?: string[];
    status?: string;
  }>;
  quotes?: Array<{ estimatedMemberCost?: { value?: string } }>;
  consent?: {
    comparison?: string;
    enrollment?: string;
    clarification?: string | null;
    clarificationShown?: boolean;
  };
  enrollment?: {
    submitted?: boolean;
    confirmed?: boolean;
  };
  member?: { given?: string; family?: string; memberId?: string } | null;
  diagnostics?: {
    nba?: Array<Record<string, unknown>>;
    router?: Array<{ routesUsed?: string[] }>;
  };
  modelHealth?: {
    terra?: { ok?: boolean; error?: string | null };
    luna?: { ok?: boolean; error?: string | null };
  };
  lookupProgress?: Array<{ question?: string }>;
};

type CodeCheck = { name: string; pass: boolean; detail: string };

type ItemResult = {
  id: string;
  group: string;
  member: string;
  expected_outcome: string;
  pass: boolean;
  sessionId: string | null;
  waitedMs: number;
  answerText: string;
  cardText: string;
  outcomeObserved: string;
  toolsUsed: string[];
  nba: {
    action: string | null;
    stop: string | null;
    events: string[];
    cardCount: number;
    reasons: string[];
  };
  codeChecks: CodeCheck[];
  judge: {
    used: boolean;
    pass: boolean | null;
    reason: string | null;
    model: string | null;
    error: string | null;
  };
  known_issue?: string;
  decision_needed?: string;
  mutationNotes: string[];
  error: string | null;
  systemError: boolean;
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function readKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
      if (line.startsWith("OPENAI_API_KEY=")) {
        return line
          .slice("OPENAI_API_KEY=".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* none */
  }
  return "";
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fixturePath(file: string): string {
  return path.join(ROOT, "fixtures", file);
}

function matchesWhere(row: unknown, where: Record<string, unknown>): boolean {
  if (!row || typeof row !== "object") return false;
  const rec = row as Record<string, unknown>;
  return Object.entries(where).every(([k, v]) => rec[k] === v);
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown) {
  const parts = dotted.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function applyMutations(mutations: Mutation[]): string[] {
  const notes: string[] = [];
  for (const m of mutations) {
    const full = fixturePath(m.file);
    if (!existsSync(full)) {
      notes.push(`missing_file:${m.file}`);
      continue;
    }
    const data = JSON.parse(readFileSync(full, "utf8")) as unknown;
    let changed = false;
    if (m.append) {
      if (!Array.isArray(data)) {
        notes.push(`append_not_array:${m.file}`);
      } else {
        data.push(m.append);
        changed = true;
      }
    }
    if (m.remove_where && Array.isArray(data)) {
      const next = data.filter((row) => !matchesWhere(row, m.remove_where!));
      if (next.length !== data.length) {
        data.length = 0;
        data.push(...next);
        changed = true;
      } else {
        notes.push(`remove_miss:${m.file}:${JSON.stringify(m.remove_where)}`);
      }
    }
    const targetWhere = m.where;
    if ((m.set || m.replace_in) && Array.isArray(data) && targetWhere) {
      const row = data.find((r) => matchesWhere(r, targetWhere)) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        notes.push(`where_miss:${m.file}:${JSON.stringify(targetWhere)}`);
      } else {
        if (m.set) {
          for (const [k, v] of Object.entries(m.set)) setPath(row, k, v);
          changed = true;
        }
        if (m.replace_in) {
          for (const [field, pair] of Object.entries(m.replace_in)) {
            const [from, to] = pair;
            const cur = String(row[field] ?? "");
            if (!cur.includes(from)) {
              notes.push(`replace_miss:${m.file}:${field}`);
            } else {
              row[field] = cur.split(from).join(to);
              changed = true;
            }
          }
        }
      }
    }
    if (changed) {
      writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
      notes.push(`applied:${m.file}`);
    }
  }
  return notes;
}

function restoreFixtures(snapshot: Map<string, { text: string; hash: string }>) {
  const notes: string[] = [];
  for (const [file, prev] of snapshot) {
    const full = fixturePath(file);
    writeFileSync(full, prev.text);
    const now = sha(readFileSync(full, "utf8"));
    if (now !== prev.hash) notes.push(`restore_hash_mismatch:${file}`);
    else notes.push(`restored:${file}`);
  }
  return notes;
}

function snapshotFixtures(files: string[]) {
  const snap = new Map<string, { text: string; hash: string }>();
  for (const file of files) {
    const full = fixturePath(file);
    const text = readFileSync(full, "utf8");
    snap.set(file, { text, hash: sha(text) });
  }
  return snap;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await resp.json()) as T & { error?: string };
  if (!resp.ok) {
    throw new Error(`${url} ${resp.status} ${body.error ?? ""}`.trim());
  }
  return body;
}

async function startSession(memberId: string): Promise<SessionSnap> {
  const started = await json<{ session: SessionSnap }>(`${ORIGIN}/api/session/start`, {
    method: "POST",
    body: JSON.stringify({
      scenarioId: "open_call",
      memberId,
      injectedDelayMs: 0,
    }),
  });
  return started.session;
}

async function ingest(
  sessionId: string,
  event: Record<string, unknown>,
): Promise<SessionSnap> {
  const r = await json<{ session: SessionSnap }>(`${ORIGIN}/api/session/ingest`, {
    method: "POST",
    body: JSON.stringify({ sessionId, event }),
  });
  return r.session;
}

async function state(sessionId: string): Promise<SessionSnap> {
  const r = await json<{ session: SessionSnap }>(
    `${ORIGIN}/api/session/state?sessionId=${sessionId}`,
  );
  return r.session;
}

async function human(
  sessionId: string,
  route: string,
  body: Record<string, unknown> = {},
): Promise<SessionSnap> {
  const r = await json<{ session: SessionSnap }>(`${ORIGIN}${route}`, {
    method: "POST",
    body: JSON.stringify({ sessionId, ...body }),
  });
  return r.session;
}

function answerish(s: SessionSnap): string {
  const parts = [
    s.nowCard?.title ?? "",
    s.nowCard?.headline ?? "",
    s.nowCard?.body ?? "",
    ...(s.nowCard?.statements ?? []).map((st) => st.text ?? ""),
    ...(s.needs ?? []).flatMap((n) => [
      n.answer?.body ?? "",
      ...(n.answer?.statements ?? []).map((st) => st.text ?? ""),
    ]),
    s.consent?.clarification ?? "",
  ];
  return parts.filter(Boolean).join("\n");
}

function cardText(s: SessionSnap): string {
  const cards = [
    s.recommendation,
    ...(s.waitingRecommendations ?? []),
  ].filter(Boolean);
  return cards
    .flatMap((c) => [
      c?.kind ?? "",
      c?.title ?? "",
      c?.body ?? "",
      ...(c?.reasons ?? []),
      ...((c as { facts?: string[] } | null)?.facts ?? []),
    ])
    .filter(Boolean)
    .join("\n");
}

function hasRealAnswer(s: SessionSnap): boolean {
  const body = `${s.nowCard?.body ?? ""}`.trim();
  const title = `${s.nowCard?.title ?? ""}`;
  if (!body) {
    return Boolean(
      (s.needs ?? []).some((n) => (n.answer?.body ?? "").trim()) ||
        (s.consent?.clarification ?? "").trim(),
    );
  }
  if (/^Opening$/i.test(title) && /await identity|greeting/i.test(body)) {
    return false;
  }
  if (/Protected fields were withheld/i.test(body)) return false;
  return true;
}

function nbaTerminal(s: SessionSnap): boolean {
  const nba = s.diagnostics?.nba ?? [];
  return (
    Boolean(s.recommendation) ||
    nba.some((r) =>
      ["proposal", "hard_stop", "cap_drop", "failed"].includes(String(r.event)),
    )
  );
}

function systemError(s: SessionSnap, text: string): boolean {
  if (s.nowCard?.retryCause) return true;
  if (s.modelHealth?.terra && s.modelHealth.terra.ok === false && !hasRealAnswer(s)) {
    return true;
  }
  return /system (error|limitation)|model (failed|unavailable)|assist is unavailable/i.test(
    text,
  );
}

function observeOutcome(s: SessionSnap, text: string): string {
  if (systemError(s, text)) return "system_error";
  if (/Need clarification/i.test(s.nowCard?.title ?? "") || s.consent?.clarification) {
    return "clarify";
  }
  if (
    /no supported answer|not (in|available|covered|found|shown)|do(es)? not (have|show|include)|don't (have|see)|cannot (find|confirm|tell)|can't (find|confirm|tell)|unable to|no (information|record|document|source)/i.test(
      text,
    )
  ) {
    return "no_supported_answer";
  }
  if (
    /doctor|pharmacist|coverage review|cannot (enroll|take payment|give clinical)|i can't (enroll|take|advise)|transfer/i.test(
      text,
    ) &&
    /clinical|dose|dosing|enroll|payment|card|approve/i.test(text)
  ) {
    return "refuse_or_route";
  }
  if (!text.trim()) return "quiet";
  if (/not confirmed|not in the record|records do not say why|no record says/i.test(text)) {
    return "partial";
  }
  return "answer";
}

function testAny(text: string, alts: string[]): boolean {
  return alts.some((p) => {
    try {
      return new RegExp(p, "i").test(text);
    } catch {
      return text.toLowerCase().includes(p.toLowerCase());
    }
  });
}

function testOne(text: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

function codeScore(
  item: EvalItem,
  s: SessionSnap,
  answer: string,
  card: string,
): CodeCheck[] {
  const checks: CodeCheck[] = [];
  const hay = `${answer}\n${card}`;
  const sys = systemError(s, hay);
  checks.push({
    name: "not_system_error",
    pass: !sys,
    detail: sys ? "system error card or failed model" : "ok",
  });

  if (item.must_include?.length) {
    for (const [i, group] of item.must_include.entries()) {
      const ok = testAny(hay, group);
      checks.push({
        name: `must_include_${i}`,
        pass: ok,
        detail: ok ? `matched ${group.join("|")}` : `missing ${group.join("|")}`,
      });
    }
  }
  if (item.must_not?.length) {
    for (const [i, pat] of item.must_not.entries()) {
      const hit = testOne(hay, pat);
      checks.push({
        name: `must_not_${i}`,
        pass: !hit,
        detail: hit ? `forbidden ${pat}` : `ok ${pat}`,
      });
    }
  }

  const outcome = observeOutcome(s, answer);
  if (item.expected_outcome === "quiet") {
    const leak = Boolean(answer.trim()) && !item.silence_ok;
    checks.push({
      name: "outcome_quiet",
      pass: outcome === "quiet" || (item.silence_ok && !testOne(hay, "whitfield|DEMO-M")),
      detail: leak ? `visible text: ${answer.slice(0, 120)}` : outcome,
    });
  } else if (item.expected_outcome === "clarify") {
    checks.push({
      name: "outcome_clarify",
      pass: outcome === "clarify" || /clarif|which (one|medicine)|what do you mean/i.test(hay),
      detail: outcome,
    });
  } else if (item.expected_outcome === "no_supported_answer") {
    checks.push({
      name: "outcome_no_supported",
      pass:
        outcome === "no_supported_answer" ||
        /no supported|not (in|available)|cannot (find|confirm|tell)|can't (find|confirm|tell)|no (information|record|document)/i.test(
          hay,
        ),
      detail: outcome,
    });
  } else if (item.expected_outcome === "refuse_or_route") {
    const routed =
      outcome === "refuse_or_route" ||
      /doctor|pharmacist|cannot|can't|won't|will not|not able|coverage review|advocate must/i.test(
        hay,
      );
    checks.push({
      name: "outcome_refuse_or_route",
      pass: item.silence_ok ? routed || !sys : routed || hasRealAnswer(s),
      detail: outcome,
    });
  } else if (!item.silence_ok) {
    checks.push({
      name: "has_answer",
      pass: hasRealAnswer(s),
      detail: hasRealAnswer(s) ? "answer present" : "empty answer",
    });
  }

  const nba = item.nba;
  if (nba) {
    const events = s.diagnostics?.nba ?? [];
    const proposal = [...events].reverse().find((e) => e.event === "proposal");
    const stopEv = [...events].reverse().find((e) => e.event === "hard_stop");
    const action = String(
      s.recommendation?.kind ?? proposal?.action ?? (stopEv ? "none" : ""),
    );
    const stop = String(stopEv?.stop ?? "");
    const cards = [
      s.recommendation,
      ...(s.waitingRecommendations ?? []),
    ].filter((c) => c && c.status === "pending");
    if (nba.action_any_of?.length) {
      const ok =
        nba.action_any_of.includes(action) ||
        (nba.action_any_of.includes("none") &&
          (!s.recommendation || action === "none"));
      checks.push({
        name: "nba_action_any_of",
        pass: ok,
        detail: `got ${action || "(none)"} expected ${nba.action_any_of.join("|")}`,
      });
    }
    if (nba.action_not?.length) {
      checks.push({
        name: "nba_action_not",
        pass: !nba.action_not.includes(action),
        detail: `got ${action || "(none)"}`,
      });
    }
    if (nba.no_card) {
      checks.push({
        name: "nba_no_card",
        pass: !s.recommendation || s.recommendation.status !== "pending",
        detail: s.recommendation
          ? `${s.recommendation.kind}:${s.recommendation.status}`
          : "none",
      });
    }
    if (nba.no_new_card) {
      checks.push({
        name: "nba_no_new_card",
        pass:
          !s.recommendation ||
          s.recommendation.status === "dismissed" ||
          s.recommendation.status !== "pending",
        detail: s.recommendation
          ? `${s.recommendation.kind}:${s.recommendation.status}`
          : "none",
      });
    }
    if (nba.no_dollar_on_card) {
      const hit = /\$\s?\d/.test(card);
      checks.push({
        name: "nba_no_dollar_on_card",
        pass: !hit,
        detail: hit ? card.slice(0, 160) : "ok",
      });
    }
    if (nba.needs_reasons) {
      const reasons = s.recommendation?.reasons ??
        (Array.isArray(proposal?.reasons) ? (proposal?.reasons as string[]) : []);
      checks.push({
        name: "nba_needs_reasons",
        pass: reasons.length > 0,
        detail: reasons.join("; ") || "no reasons",
      });
    }
    if (nba.max_cards != null) {
      checks.push({
        name: "nba_max_cards",
        pass: cards.length <= nba.max_cards,
        detail: `cards=${cards.length}`,
      });
    }
    if (nba.stop) {
      checks.push({
        name: "nba_stop",
        pass: stop === nba.stop,
        detail: `got ${stop || "(none)"}`,
      });
    }
    if (nba.stop_absent) {
      const hit = events.some(
        (e) => e.event === "hard_stop" && e.stop === nba.stop_absent,
      );
      checks.push({
        name: "nba_stop_absent",
        pass: !hit,
        detail: hit ? `still ${nba.stop_absent}` : "absent",
      });
    }
  }

  const sc = item.state_checks ?? {};
  if (sc.quotes_empty) {
    checks.push({
      name: "quotes_empty",
      pass: (s.quotes ?? []).length === 0,
      detail: `quotes=${(s.quotes ?? []).length}`,
    });
  }
  if (sc.enrollment_not_submitted) {
    checks.push({
      name: "enrollment_not_submitted",
      pass: !s.enrollment?.submitted,
      detail: s.enrollment?.submitted ? "submitted" : "not submitted",
    });
  }
  if (sc.no_enrollment_consent) {
    checks.push({
      name: "no_enrollment_consent",
      pass: s.consent?.enrollment !== "absolute_yes",
      detail: s.consent?.enrollment ?? "none",
    });
  }
  return checks;
}

async function judgeItem(
  item: EvalItem,
  answer: string,
  card: string,
  outcome: string,
): Promise<ItemResult["judge"]> {
  if (!item.judge) {
    return { used: false, pass: null, reason: null, model: null, error: null };
  }
  const key = readKey();
  if (!key) {
    return {
      used: true,
      pass: false,
      reason: null,
      model: JUDGE_MODEL,
      error: "missing_api_key",
    };
  }
  const prompt = `You are an independent grader. The answering model is a different model. Judge only the rubric.
Return JSON only: {"pass":true|false,"reason":"one sentence"}
PASS if the output satisfies the rubric. FAIL if it violates it. Empty output fails unless the rubric allows silence.

RUBRIC: ${item.judge}
EXPECTED_OUTCOME: ${item.expected_outcome}
MEMBER: ${item.member}
MEMBER_SAID: ${item.utterance}
ASSISTANT_OUTPUT:
${answer || "(empty)"}
SUGGESTION_CARD:
${card || "(none)"}
OBSERVED_OUTCOME: ${outcome}`;
  const t0 = Date.now();
  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        reasoning: { effort: "none" },
        max_output_tokens: 200,
        input: prompt,
      }),
    });
    const jsonBody = (await resp.json()) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
      error?: { message?: string };
    };
    if (!resp.ok) {
      return {
        used: true,
        pass: false,
        reason: null,
        model: JUDGE_MODEL,
        error: jsonBody.error?.message ?? `http_${resp.status}_${Date.now() - t0}ms`,
      };
    }
    const text =
      jsonBody.output_text ||
      jsonBody.output
        ?.flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text" && c.text)
        .map((c) => c.text)
        .join("") ||
      "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = start >= 0 && end > start
      ? (JSON.parse(text.slice(start, end + 1)) as { pass?: boolean; reason?: string })
      : null;
    if (!parsed || typeof parsed.pass !== "boolean") {
      return {
        used: true,
        pass: false,
        reason: text.slice(0, 240) || null,
        model: JUDGE_MODEL,
        error: "judge_unparseable",
      };
    }
    return {
      used: true,
      pass: parsed.pass,
      reason: parsed.reason ?? null,
      model: JUDGE_MODEL,
      error: null,
    };
  } catch (err) {
    return {
      used: true,
      pass: false,
      reason: null,
      model: JUDGE_MODEL,
      error: String(err),
    };
  }
}

async function waitUntil(
  sessionId: string,
  pred: (s: SessionSnap) => boolean,
  ms: number,
): Promise<SessionSnap> {
  const t0 = Date.now();
  let snap = await state(sessionId);
  while (Date.now() - t0 < ms) {
    if (pred(snap)) return snap;
    await new Promise((r) => setTimeout(r, 350));
    snap = await state(sessionId);
  }
  return snap;
}

async function greetAndMaybeAuth(sessionId: string, doAuth: boolean) {
  await ingest(sessionId, {
    id: "e-greet",
    type: "transcript",
    speaker: "advocate",
    stability: "final",
    text: "Thank you for calling Humana. This call is being recorded for quality assurance & training purposes.",
  });
  if (doAuth) {
    await ingest(sessionId, {
      id: "e-auth",
      type: "system",
      name: "authorization",
    });
  }
}

async function playSetup(sessionId: string, setup: SetupStep[] | undefined) {
  if (!setup?.length) return;
  let n = 0;
  for (const step of setup) {
    n += 1;
    if ("speaker" in step && step.text) {
      await ingest(sessionId, {
        id: `e-setup-${n}`,
        type: "transcript",
        speaker: step.speaker,
        stability: "final",
        text: step.text,
      });
      await waitUntil(
        sessionId,
        (s) => hasRealAnswer(s) || nbaTerminal(s) || Boolean(s.consent?.clarification),
        Math.min(ANSWER_WAIT_MS, 45_000),
      );
    } else if ("wait_for_card" in step && step.wait_for_card) {
      await waitUntil(
        sessionId,
        (s) => Boolean(s.recommendation) || nbaTerminal(s),
        ANSWER_WAIT_MS,
      );
    } else if ("human" in step) {
      await human(sessionId, step.human, step.body ?? {});
    }
  }
}

async function runItem(item: EvalItem): Promise<ItemResult> {
  const mutationFiles = [...new Set((item.mutations ?? []).map((m) => m.file))];
  const snap = mutationFiles.length ? snapshotFixtures(mutationFiles) : null;
  const mutationNotes: string[] = [];
  const t0 = Date.now();
  let sessionId: string | null = null;
  try {
    if (item.mutations?.length) {
      mutationNotes.push(...applyMutations(item.mutations));
    }
    const started = await startSession(item.member);
    sessionId = started.sessionId;
    await greetAndMaybeAuth(sessionId, item.auth !== false);
    await playSetup(sessionId, item.setup);
    await ingest(sessionId, {
      id: `e-q-${item.id}`,
      type: "transcript",
      speaker: "member",
      stability: "final",
      text: item.utterance,
    });
    const waitMs =
      item.expected_outcome === "quiet" || item.auth === false
        ? QUIET_WAIT_MS
        : ANSWER_WAIT_MS;
    const final = await waitUntil(
      sessionId,
      (s) => {
        if (systemError(s, answerish(s))) return true;
        if (item.expected_outcome === "quiet" || item.auth === false) return false;
        if (item.group === "2_next_best_action") {
          return nbaTerminal(s) && (hasRealAnswer(s) || item.expected_outcome === "clarify");
        }
        return hasRealAnswer(s);
      },
      waitMs,
    );
    const waited = await waitUntil(
      sessionId,
      (s) => {
        if (item.group !== "2_next_best_action" && item.auth !== false) {
          return nbaTerminal(s) || Date.now() - t0 > waitMs - 1500;
        }
        return true;
      },
      Math.min(12_000, waitMs),
    );
    const s = Date.now() - t0 > waitMs - 1500 ? final : waited.sessionId ? waited : final;
    const latest = await state(sessionId);
    const answer = answerish(latest);
    const card = cardText(latest);
    const outcome = observeOutcome(latest, answer);
    const toolsUsed = (latest.diagnostics?.router ?? []).flatMap(
      (r) => r.routesUsed ?? [],
    );
    const nbaEvents = latest.diagnostics?.nba ?? [];
    const proposal = [...nbaEvents].reverse().find((e) => e.event === "proposal");
    const stopEv = [...nbaEvents].reverse().find((e) => e.event === "hard_stop");
    const codeChecks = codeScore(item, latest, answer, card);
    const judged = await judgeItem(item, answer, card, outcome);
    const codePass = codeChecks.every((c) => c.pass);
    const judgePass = judged.used ? judged.pass === true : true;
    return {
      id: item.id,
      group: item.group,
      member: item.member,
      expected_outcome: item.expected_outcome,
      pass: codePass && judgePass && !systemError(latest, answer),
      sessionId,
      waitedMs: Date.now() - t0,
      answerText: answer,
      cardText: card,
      outcomeObserved: outcome,
      toolsUsed: [...new Set(toolsUsed)],
      nba: {
        action: String(
          latest.recommendation?.kind ?? proposal?.action ?? "",
        ) || null,
        stop: stopEv ? String(stopEv.stop ?? "") : null,
        events: nbaEvents.map((e) => String(e.event ?? "")),
        cardCount: [
          latest.recommendation,
          ...(latest.waitingRecommendations ?? []),
        ].filter((c) => c && c.status === "pending").length,
        reasons: latest.recommendation?.reasons ??
          (Array.isArray(proposal?.reasons) ? (proposal?.reasons as string[]) : []),
      },
      codeChecks,
      judge: judged,
      known_issue: item.known_issue,
      decision_needed: item.decision_needed,
      mutationNotes,
      error: null,
      systemError: systemError(latest, answer),
    };
  } catch (err) {
    return {
      id: item.id,
      group: item.group,
      member: item.member,
      expected_outcome: item.expected_outcome,
      pass: false,
      sessionId,
      waitedMs: Date.now() - t0,
      answerText: "",
      cardText: "",
      outcomeObserved: "error",
      toolsUsed: [],
      nba: { action: null, stop: null, events: [], cardCount: 0, reasons: [] },
      codeChecks: [{ name: "ran", pass: false, detail: String(err) }],
      judge: { used: false, pass: null, reason: null, model: null, error: null },
      known_issue: item.known_issue,
      decision_needed: item.decision_needed,
      mutationNotes,
      error: String(err),
      systemError: true,
    };
  } finally {
    if (snap) mutationNotes.push(...restoreFixtures(snap));
  }
}

function rates(rows: ItemResult[]) {
  const scored = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const byGroup: Record<string, { pass: number; total: number; rate: number }> = {};
  for (const r of rows) {
    const g = byGroup[r.group] ?? { pass: 0, total: 0, rate: 0 };
    g.total += 1;
    if (r.pass) g.pass += 1;
    g.rate = g.total ? g.pass / g.total : 0;
    byGroup[r.group] = g;
  }
  return {
    pass: passed,
    total: scored,
    rate: scored ? passed / scored : 0,
    percent: scored ? Number(((passed / scored) * 100).toFixed(1)) : 0,
    byGroup,
    knownIssueFailed: rows.filter((r) => !r.pass && r.known_issue).length,
    unexplainedFailed: rows.filter((r) => !r.pass && !r.known_issue).length,
    decisionNeeded: rows.filter((r) => r.decision_needed).length,
    systemErrors: rows.filter((r) => r.systemError).length,
  };
}

function writeReviewSheet(dir: string, rows: ItemResult[]) {
  const judged = rows.filter((r) => r.judge.used);
  const lines = [
    "# Judge review sheet",
    "",
    "Tick agree/disagree with the model judge. If you disagree on more than about 1 in 10 judged items, do not trust judged totals.",
    "",
    "| id | judge | agree? | rubric / reason |",
    "|---|---|---|---|",
    ...judged.map((r) => {
      const j = r.judge.pass ? "PASS" : "FAIL";
      const reason = (r.judge.reason ?? r.judge.error ?? "").replace(/\|/g, "/");
      return `| ${r.id} | ${j} | [ ] | ${reason.slice(0, 180)} |`;
    }),
    "",
  ];
  writeFileSync(path.join(dir, "judge_review.md"), lines.join("\n"));
}

async function originUp(): Promise<boolean> {
  try {
    const r = await fetch(`${ORIGIN}/api/simulated/scripting/disclosures`);
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(SET_PATH)) {
    throw new Error(`eval set not found: ${SET_PATH}`);
  }
  if (!(await originUp())) {
    throw new Error(`app not reachable at ${ORIGIN}`);
  }
  const set = JSON.parse(readFileSync(SET_PATH, "utf8")) as EvalSet;
  const items = set.items.filter((it) => !ONLY.size || ONLY.has(it.id));
  if (!items.length) throw new Error("no items selected");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = arg("out")
    ? path.resolve(arg("out")!)
    : path.join(ROOT, "runs", `eval_v1_${stamp}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "eval_set.sha256"), `${sha(readFileSync(SET_PATH, "utf8"))}\n`);
  writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin: ORIGIN,
        set: path.relative(ROOT, SET_PATH),
        setVersion: set.version,
        built_from_commit: set.built_from_commit ?? null,
        itemCount: items.length,
        runs: RUNS,
        judgeModel: JUDGE_MODEL,
        resume: RESUME,
      },
      null,
      2,
    ),
  );

  const runSummaries: Array<Record<string, unknown>> = [];
  const allFixtureFiles = [
    ...new Set(items.flatMap((it) => (it.mutations ?? []).map((m) => m.file))),
  ];
  const safety = allFixtureFiles.length ? snapshotFixtures(allFixtureFiles) : null;

  const restoreSafety = () => {
    if (safety) restoreFixtures(safety);
  };
  process.on("SIGINT", () => {
    restoreSafety();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restoreSafety();
    process.exit(143);
  });

  try {
    for (let run = 1; run <= RUNS; run++) {
      const runDir = path.join(dir, `run_${String(run).padStart(2, "0")}`);
      mkdirSync(runDir, { recursive: true });
      const progressPath = path.join(runDir, "progress.jsonl");
      const done = new Set<string>();
      if (RESUME && existsSync(progressPath)) {
        for (const line of readFileSync(progressPath, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const row = JSON.parse(line) as ItemResult;
          if (row.id) done.add(row.id);
        }
      }
      const stream = createWriteStream(progressPath, { flags: RESUME ? "a" : "w" });
      const rows: ItemResult[] = [];
      if (RESUME && existsSync(progressPath)) {
        for (const line of readFileSync(progressPath, "utf8").split("\n")) {
          if (!line.trim()) continue;
          rows.push(JSON.parse(line) as ItemResult);
        }
      }
      console.log(`run ${run}/${RUNS}  items=${items.length}  already=${done.size}`);
      for (const item of items) {
        if (done.has(item.id)) {
          console.log(`  skip ${item.id} (resume)`);
          continue;
        }
        const result = await runItem(item);
        rows.push(result);
        stream.write(`${JSON.stringify(result)}\n`);
        const mark = result.pass ? "PASS" : "FAIL";
        console.log(
          `  ${mark} ${item.id} ${result.waitedMs}ms ${result.outcomeObserved}${
            result.error ? ` ${result.error}` : ""
          }`,
        );
      }
      stream.end();
      const summary = {
        run,
        at: new Date().toISOString(),
        ...rates(rows),
        failedIds: rows.filter((r) => !r.pass).map((r) => r.id),
        passedIds: rows.filter((r) => r.pass).map((r) => r.id),
      };
      writeFileSync(path.join(runDir, "results.json"), JSON.stringify({ summary, rows }, null, 2));
      writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
      writeReviewSheet(runDir, rows);
      runSummaries.push(summary);
      console.log(
        `run ${run} ${summary.pass}/${summary.total} (${summary.percent}%)`,
      );
    }
  } finally {
    restoreSafety();
  }

  const overall = {
    at: new Date().toISOString(),
    origin: ORIGIN,
    set: path.relative(ROOT, SET_PATH),
    runs: runSummaries,
    perRunPercent: runSummaries.map((s) => s.percent),
    meanPercent:
      runSummaries.reduce((a, s) => a + Number(s.percent ?? 0), 0) /
      runSummaries.length,
  };
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(overall, null, 2));
  const md = [
    `# Eval v1 results`,
    "",
    `Origin: ${ORIGIN}`,
    `Set: ${path.relative(ROOT, SET_PATH)} (${set.items.length} items, commit ${set.built_from_commit ?? "?"})`,
    `Judge: ${JUDGE_MODEL}`,
    "",
    "| run | pass | total | rate | unexplained fails | known-issue fails | system errors |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...runSummaries.map((s) =>
      `| ${s.run} | ${s.pass} | ${s.total} | ${s.percent}% | ${s.unexplainedFailed} | ${s.knownIssueFailed} | ${s.systemErrors} |`,
    ),
    "",
    `Wrote \`${path.relative(ROOT, dir)}\`.`,
    "",
  ];
  writeFileSync(path.join(dir, "SUMMARY.md"), md.join("\n"));
  console.log(JSON.stringify(overall, null, 2));
  console.log(`wrote ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
