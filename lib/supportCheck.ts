/** Per-statement support check. Does not choose tools. */

import type { CitedStatement, RetrievedSource } from "@/lib/citations";

const MONEY = /\$\d+(?:\.\d{2})?|\b\d+\.\d{2}\b/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const IDISH = /\bDEMO-[A-Z0-9-]+\b/g;
const STATUS =
  /\b(READY_FOR_PICKUP|PENDING_REVIEW|invalidated)\b/gi;

function atoms(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.match(MONEY) ?? []) {
    found.add(m.replace(/^\$/, ""));
  }
  for (const m of text.match(ISO_DATE) ?? []) found.add(m);
  for (const m of text.match(IDISH) ?? []) found.add(m);
  for (const m of text.match(STATUS) ?? []) found.add(m);
  for (const n of text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []) {
    found.add(n);
  }
  return [...found];
}

function hay(source: RetrievedSource): string {
  return source.text.toLowerCase();
}

function findSource(
  sourceId: string,
  retrieved: RetrievedSource[],
): RetrievedSource | undefined {
  if (!sourceId) return undefined;
  const want = sourceId.toLowerCase();
  return retrieved.find(
    (s) =>
      s.id.toLowerCase() === want ||
      hay(s).includes(want) ||
      sourceId.toLowerCase().includes(s.id.toLowerCase()),
  );
}

function needsClassification(text: string): boolean {
  return (
    /\b(preferred|standard)(_retail|\s+retail)?\b/i.test(text) ||
    /\bclassified\b/i.test(text)
  );
}

function verifyOne(
  st: { text: string; sourceId: string },
  retrieved: RetrievedSource[],
): CitedStatement {
  const source = findSource(st.sourceId, retrieved);
  if (!source) {
    const fallback = retrieved.find((s) =>
      atoms(st.text).every((a) => hay(s).includes(a.toLowerCase())),
    );
    if (!st.sourceId && fallback && !needsClassification(st.text)) {
      return confirm(st.text, fallback);
    }
    if (needsClassification(st.text)) {
      const cls = classificationForStatement(st.text, retrieved);
      if (cls) return confirm(st.text, cls);
      return {
        text: st.text,
        sourceId: st.sourceId,
        sourceTag: "Not confirmed",
        confirmed: false,
        note: "network_tier_without_dated_classification",
      };
    }
    return {
      text: st.text,
      sourceId: st.sourceId,
      sourceTag: "Not confirmed",
      confirmed: false,
      note: st.sourceId ? "source_not_retrieved" : "source_missing",
    };
  }
  if (needsClassification(st.text) && source.kind !== "classification") {
    const cls = classificationForStatement(st.text, retrieved);
    if (cls) return confirm(st.text, cls);
    return {
      text: st.text,
      sourceId: source.id,
      sourceTag: "Not confirmed",
      confirmed: false,
      note: "network_tier_without_dated_classification",
    };
  }
  const missing = atoms(st.text).filter(
    (a) => !hay(source).includes(a.toLowerCase()),
  );
  if (missing.length) {
    return {
      text: st.text,
      sourceId: source.id,
      sourceTag: "Not confirmed",
      confirmed: false,
      note: `value_not_in_source:${missing.join(",")}`,
      highlight: missing[0],
    };
  }
  return confirm(st.text, source);
}

function classificationForStatement(
  text: string,
  retrieved: RetrievedSource[],
): RetrievedSource | undefined {
  const date = (text.match(ISO_DATE) ?? [])[0];
  const name = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/) ?? [])[0];
  const tier = /\bpreferred\b/i.test(text)
    ? "preferred"
    : /\bstandard\b/i.test(text)
      ? "standard"
      : "";
  return retrieved.find((s) => {
    if (s.kind !== "classification") return false;
    const h = hay(s);
    if (tier && !h.includes(tier)) return false;
    if (date && !h.includes(date.toLowerCase())) return false;
    if (name && !h.includes(name.toLowerCase().replace(" pharmacy", ""))) {
      return false;
    }
    return Boolean(h.includes("asofdate") || h.match(ISO_DATE));
  });
}

function unmatchedFillClassifications(retrieved: RetrievedSource[]): boolean {
  const claims = retrieved.filter(
    (s) => s.kind === "record" && s.sourceTag === "Claims",
  );
  const classes = retrieved.filter((s) => s.kind === "classification");
  if (!claims.length) return false;
  return claims.some((c) => {
    let date = "";
    let pharmacy = "";
    try {
      const row = JSON.parse(c.text) as {
        dateOfService?: string;
        pharmacy?: string;
      };
      date = row.dateOfService ?? "";
      pharmacy = row.pharmacy ?? "";
    } catch {
      date = (c.text.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0] ?? "";
    }
    if (!date) return false;
    return !classes.some((cl) => {
      const h = cl.text.toLowerCase();
      return (
        h.includes(date.toLowerCase()) &&
        (!pharmacy || h.includes(pharmacy.toLowerCase().replace(" pharmacy", "")))
      );
    });
  });
}

function confirm(text: string, source: RetrievedSource): CitedStatement {
  const highlight = atoms(text)[0] ?? text.slice(0, 24);
  return {
    text,
    sourceId: source.id,
    sourceTag: source.sourceTag,
    confirmed: true,
    highlight,
  };
}

export function supportCheck(args: {
  question: string;
  answer: string;
  statements?: { text: string; sourceId: string }[];
  retrieved?: RetrievedSource[];
  toolsUsed: string[];
  snapshotHasPlanRule: boolean;
  sources: string[];
}): {
  partial: boolean;
  body: string;
  note: string | null;
  statements: CitedStatement[];
  ms: number;
} {
  const started = performance.now();
  const retrieved = args.retrieved ?? [];
  const input = args.statements?.length
    ? args.statements
    : args.answer
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, sourceId: args.sources[0] ?? "" }));

  let statements = input.map((st) => verifyOne(st, retrieved));
  const unmatched = unmatchedFillClassifications(retrieved);
  if (unmatched) {
    statements = statements.map((s) =>
      needsClassification(s.text)
        ? {
            ...s,
            confirmed: false,
            sourceTag: "Not confirmed",
            note: "network_tier_without_dated_classification",
          }
        : s,
    );
  }
  const confirmed = statements.filter((s) => s.confirmed);
  const failed = statements.filter((s) => !s.confirmed);
  const causeFailed = failed.some(
    (s) => s.note === "network_tier_without_dated_classification",
  );

  let body = confirmed.map((s) => s.text).join(" ");
  if (causeFailed) {
    body = `${body}${body ? " " : ""}The cause is not confirmed.`.trim();
  } else if (failed.length && !body) {
    body = "Not confirmed from retrieved records.";
  }

  const approval = /\b(approv|authorized coverage|coverage granted)\b/i.test(
    args.answer,
  );
  if (approval) {
    return {
      partial: true,
      body: "This role cannot determine coverage. Status only.",
      note: "approval_claim",
      statements,
      ms: performance.now() - started,
    };
  }

  const partial = failed.length > 0 || causeFailed;
  return {
    partial,
    body: body || args.answer,
    note: failed[0]?.note ?? (partial ? "unconfirmed_statement" : null),
    statements: causeFailed
      ? [
          ...statements,
          {
            text: "The cause is not confirmed.",
            sourceId: "",
            sourceTag: "Not confirmed",
            confirmed: false,
            note: "cause_not_confirmed",
          },
        ]
      : statements,
    ms: performance.now() - started,
  };
}

export function unconfirmedTokens(statements: CitedStatement[]): string[] {
  const toks = new Set<string>();
  for (const s of statements.filter(
    (x) => !x.confirmed && x.note !== "cause_not_confirmed",
  )) {
    if (s.note === "network_tier_without_dated_classification") {
      if (/\bpreferred\b/i.test(s.text)) toks.add("preferred");
      if (/\bstandard\b/i.test(s.text)) toks.add("standard");
      continue;
    }
    const fromNote = s.note?.startsWith("value_not_in_source:")
      ? s.note.slice("value_not_in_source:".length).split(",")
      : atoms(s.text);
    for (const a of fromNote) toks.add(a.toLowerCase());
  }
  return [...toks];
}

export function confirmedTokens(statements: CitedStatement[]): string[] {
  const toks = new Set<string>();
  for (const s of statements.filter((x) => x.confirmed)) {
    for (const a of atoms(s.text)) toks.add(a.toLowerCase());
  }
  return [...toks];
}
