/** Retrieved sources and member-record facts. No scenario names. */

export type RetrievedKind =
  | "classification"
  | "record"
  | "document"
  | "transcript"
  | "playbook";

export type RetrievedSource = {
  id: string;
  kind: RetrievedKind;
  sourceTag: string;
  text: string;
};

export type CitedStatement = {
  text: string;
  sourceId: string;
  sourceTag: string;
  confirmed: boolean;
  note?: string;
  highlight?: string;
  lookedFor?: string[];
  found?: string[];
};

/** One knowledge source shown under a synthesized answer. */
export type UsedKnowledgeSource = {
  id: string;
  tag: string;
  text: string;
};

function clip(text: string, n = 90) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Short advocate-facing subject for a retrieved record or passage. */
export function sourceSubject(source: RetrievedSource): string {
  if (source.kind === "document" || source.kind === "playbook") {
    return clip(source.text) || source.sourceTag;
  }
  try {
    const row = JSON.parse(source.text) as Record<string, unknown>;
    const bits = [
      row.drugName,
      row.pharmacy ?? row.pharmacyName,
      row.fillStatus ?? row.adjudicationStatus ?? row.status,
      row.dateOfService ?? row.asOfDate,
      row.requestedMedication,
      row.networkTier,
    ]
      .filter((v) => v != null && String(v).trim())
      .map((v) => String(v));
    if (bits.length) return bits.join(" · ");
  } catch {
    /* not json */
  }
  return source.sourceTag;
}

/**
 * Sources actually used for this answer: cited statements first, then
 * records that produced facts, then knowledge passages from this lookup.
 * No named question, member, or beat.
 */
export function usedKnowledgeSources(
  retrieved: RetrievedSource[],
  statements?: CitedStatement[],
  earlyFacts?: { text: string; source: string }[],
): UsedKnowledgeSource[] {
  const byId = new Map(retrieved.map((s) => [s.id, s]));
  const out: UsedKnowledgeSource[] = [];
  const seen = new Set<string>();

  const add = (id: string, tag: string, text: string) => {
    const key = id || tag;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id, tag, text: clip(text) || tag });
  };

  for (const st of statements ?? []) {
    if (st.confirmed === false) continue;
    const src = st.sourceId ? byId.get(st.sourceId) : undefined;
    add(
      st.sourceId || src?.id || st.sourceTag,
      st.sourceTag || src?.sourceTag || "Source",
      src ? sourceSubject(src) : st.sourceTag,
    );
  }

  for (const f of earlyFacts ?? []) {
    const src =
      retrieved.find((s) => s.id && !seen.has(s.id) && s.sourceTag === f.source) ??
      retrieved.find((s) => s.sourceTag === f.source);
    add(src?.id ?? f.source, f.source, src ? sourceSubject(src) : f.text);
  }

  if (out.length === 0) {
    for (const s of retrieved) {
      add(s.id, s.sourceTag, sourceSubject(s));
    }
  }

  return out.slice(0, 6);
}

export function tagForSystem(sourceSystem: string): string {
  const s = sourceSystem.toLowerCase();
  if (s.includes("claim")) return "Claims";
  if (s.includes("pharmacy") && !s.includes("provider")) return "Pharmacy system";
  if (s.includes("provider")) return "Pharmacy directory";
  if (s.includes("eligib")) return "Eligibility";
  if (s.includes("coverage")) return "Coverage review";
  if (s.includes("telephony")) return "Phone menu";
  if (s.includes("playbook")) return "Playbook";
  if (s.includes("transcript")) return "Transcript";
  if (s.includes("benefit") || s.includes("script") || s.includes("policy")) {
    return "Plan rules";
  }
  return "Plan rules";
}

/** Recast model prose as notes for the advocate (he/his), not speech to the member. */
export function advocateFacing(text: string, given?: string): string {
  if (!text) return text;
  const he = (given ?? "").trim() || "He";
  return text
    .replace(/\bYou paid\b/g, `${he} paid`)
    .replace(/\byou paid\b/g, `${he.toLowerCase() === "he" ? "he" : he} paid`)
    .replace(/\bYou used\b/g, `${he} used`)
    .replace(/\byou used\b/g, `${he.toLowerCase() === "he" ? "he" : he} used`)
    .replace(/\byour metformin\b/gi, "his metformin")
    .replace(/\byour atorvastatin\b/gi, "his atorvastatin")
    .replace(/\byour pharmacy\b/gi, "his pharmacy")
    .replace(/\byour plan\b/gi, "his plan")
    .replace(/\byour prescription\b/gi, "his prescription")
    .replace(/\byour refill\b/gi, "his refill");
}

function innerData(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== "object") return {};
  const o = json as { data?: Record<string, unknown> };
  return o.data && typeof o.data === "object" ? o.data : (json as Record<string, unknown>);
}

function compact(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

/** Flatten a tool payload into citeable sources. Claims omit network category. */
export function sourcesFromTool(name: string, json: unknown): RetrievedSource[] {
  const data = innerData(json);
  const out: RetrievedSource[] = [];
  if (name === "getClaims") {
    const claims =
      (data as { claims?: Array<Record<string, unknown>> }).claims ?? [];
    for (const c of claims) {
      const paid = c.memberPaidAmount as { value?: string } | undefined;
      const ph = c.pharmacy as { name?: string; pharmacyId?: string } | undefined;
      const text = compact({
        claimId: c.claimId,
        dateOfService: c.dateOfService,
        drugName: c.drugName,
        pharmacy: ph?.name,
        memberPaidAmount: paid?.value,
        adjudicationStatus: c.adjudicationStatus,
      });
      out.push({
        id: String(c.claimId ?? ""),
        kind: "record",
        sourceTag: "Claims",
        text,
      });
    }
  }
  if (name === "getPharmacyNetwork") {
    const rows =
      (data as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    for (const r of rows) {
      out.push({
        id: String(r.classificationId ?? ""),
        kind: "classification",
        sourceTag: "Plan rules",
        text: compact({
          classificationId: r.classificationId,
          pharmacyName: r.pharmacyName,
          pharmacyId: r.pharmacyId,
          asOfDate: r.asOfDate,
          networkTier: r.networkTier,
        }),
      });
    }
  }
  if (name === "getCostShare") {
    const id = String(
      (data as { policyId?: string; articleId?: string }).policyId ??
        (data as { articleId?: string }).articleId ??
        "cost-share",
    );
    out.push({
      id,
      kind: "document",
      sourceTag: "Plan rules",
      text: String((data as { body?: string }).body ?? compact(data)),
    });
  }
  if (name === "getRefillStatus" || name === "getRefillRequests") {
    const listed = (data as { requests?: Array<Record<string, unknown>> })
      .requests;
    const rows = listed?.length
      ? listed
      : (data as { requestId?: string }).requestId ||
          (data as { fillStatus?: string }).fillStatus
        ? [data as Record<string, unknown>]
        : [];
    for (const r of rows) {
      if (!r.requestId && !(r as { fillStatus?: string }).fillStatus) continue;
      out.push({
        id: String(r.requestId ?? "refill"),
        kind: "record",
        sourceTag: "Pharmacy system",
        text: compact({
          requestId: r.requestId,
          drugName: r.drugName,
          fillStatus: r.fillStatus,
          pharmacyName: r.pharmacyName,
        }),
      });
    }
  }
  if (name === "getPharmacy") {
    const id = String(
      (data as { pharmacyId?: string }).pharmacyId ??
        (data as { organizationName?: string }).organizationName ??
        "pharmacy",
    );
    out.push({
      id,
      kind: "record",
      sourceTag: "Pharmacy directory",
      text: compact(data),
    });
  }
  if (name === "getOpenCases" || name === "getCoverageCase") {
    const rows =
      (data as { cases?: Array<Record<string, unknown>> }).cases ??
      ((data as { caseId?: string }).caseId
        ? [data as Record<string, unknown>]
        : []);
    for (const row of rows) {
      if (!row.caseId) continue;
      out.push({
        id: String(row.caseId),
        kind: "record",
        sourceTag: "Coverage review",
        text: compact({
          caseId: row.caseId,
          status: row.status,
          requestedMedication: row.requestedMedication,
          determination: row.determination,
        }),
      });
    }
  }
  if (name === "searchKnowledge") {
    const cands =
      (data as { candidates?: Array<{ id: string; text?: string; kind?: string }> })
        .candidates ?? [];
    for (const c of cands) {
      out.push({
        id: c.id,
        kind: c.kind === "playbook" ? "playbook" : "document",
        sourceTag: c.kind === "playbook" ? "Playbook" : "Plan rules",
        text: String(c.text ?? ""),
      });
    }
  }
  if (name === "getPrescriptions") {
    const rows =
      (data as { prescriptions?: Array<Record<string, unknown>> }).prescriptions ??
      [];
    for (const p of rows) {
      out.push({
        id: String(p.prescriptionId ?? p.drugName ?? "rx"),
        kind: "record",
        sourceTag: "Pharmacy system",
        text: compact({
          drugName: p.drugName,
          strength: p.strength,
        }),
      });
    }
  }
  if (name === "getQuotes") {
    const quotes =
      (data as { quotes?: Array<Record<string, unknown>> }).quotes ?? [];
    for (const q of quotes) {
      out.push({
        id: String(q.quoteId ?? ""),
        kind: "record",
        sourceTag: "Pharmacy system",
        text: compact(q),
      });
    }
  }
  if (name === "getContactPreferences") {
    out.push({
      id: "contact-preferences",
      kind: "record",
      sourceTag: "Eligibility",
      text: compact(data),
    });
  }
  if (name === "getPlan") {
    out.push({
      id: String((data as { planId?: string }).planId ?? "plan"),
      kind: "record",
      sourceTag: "Plan rules",
      text: compact({
        planId: (data as { planId?: string }).planId,
        lineOfBusiness: (data as { lineOfBusiness?: string }).lineOfBusiness,
      }),
    });
  }
  return out.filter((s) => s.id);
}

/** Facts panel: member records only. Network tier only from dated classification rows. */
export function recordFactsFromSources(
  sources: RetrievedSource[],
): { text: string; source: string }[] {
  const facts: { text: string; source: string }[] = [];
  for (const s of sources) {
    if (s.kind === "classification") {
      try {
        const row = JSON.parse(s.text) as {
          pharmacyName?: string;
          asOfDate?: string;
          networkTier?: string;
        };
        if (row.pharmacyName && row.asOfDate && row.networkTier) {
          facts.push({
            text: `${row.pharmacyName} on ${row.asOfDate}: ${row.networkTier}`,
            source: s.sourceTag,
          });
        }
      } catch {
        /* skip */
      }
    }
    if (s.kind === "record") {
      try {
        const row = JSON.parse(s.text) as Record<string, unknown>;
        const bits: string[] = [];
        const drug = row.drugName
          ? String(row.drugName)
          : row.requestedMedication
            ? String(row.requestedMedication)
            : "";
        const reference = row.caseId ? String(row.caseId) : "";
        const when = row.dateOfService ? String(row.dateOfService) : "";
        const where = row.pharmacy ? String(row.pharmacy) : String(row.pharmacyName ?? "");
        const paid = row.memberPaidAmount ? String(row.memberPaidAmount) : "";
        const status = row.fillStatus
          ? String(row.fillStatus)
          : row.adjudicationStatus
            ? String(row.adjudicationStatus)
            : row.status
              ? String(row.status)
              : "";
        if (paid && where) {
          bits.push(
            `${drug || "Fill"} on ${when || "a recorded date"} at ${where}: $${paid}${status ? ` (${status})` : ""}`,
          );
        } else if (status && (drug || where)) {
          bits.push(
            `${reference ? `${reference}: ` : ""}${drug || "Record"} ${status}${where ? ` at ${where}` : ""}`,
          );
        }
        for (const text of bits) {
          facts.push({ text, source: s.sourceTag });
        }
      } catch {
        /* skip */
      }
    }
  }
  return facts;
}

export function parseAnswerStatements(
  answer: string,
): { text: string; sourceId: string; rest: string } {
  const match = answer.match(/\{[\s\S]*"statements"[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        statements?: Array<{ text?: string; sourceId?: string }>;
      };
      const rest = answer.replace(match[0], "").trim();
      return {
        rest,
        text: (parsed.statements ?? []).map((s) => s.text ?? "").join(" "),
        sourceId: "",
      };
    } catch {
      /* fall through */
    }
  }
  return { rest: answer, text: answer, sourceId: "" };
}

function firstSentences(text: string, n = 3) {
  if (!text.trim()) return "";
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, n).join(" ");
}

/** End index of a complete `{...}` starting at `start`, or -1 if truncated. */
function completeJsonObjectEnd(raw: string, start: number): number {
  if (raw[start] !== "{") return -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function jsonStringField(raw: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
  if (!m || m.index == null) return "";
  let out = "";
  let esc = false;
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (esc) {
      out += c === "n" ? "\n" : c === "t" ? "\t" : c;
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') return out;
    out += c;
  }
  return "";
}

/**
 * When the outer envelope does not parse (truncated tail, extra braces),
 * keep every complete `{text, sourceId}` already sitting in `"statements"`.
 */
function statementsFromBrokenEnvelope(
  raw: string,
): { text: string; sourceId: string }[] {
  const marker = raw.search(/"statements"\s*:\s*\[/);
  if (marker < 0) return [];
  const start = raw.indexOf("[", marker);
  if (start < 0) return [];
  const out: { text: string; sourceId: string }[] = [];
  let i = start + 1;
  while (i < raw.length && out.length < 6) {
    while (i < raw.length && /[\s,]/.test(raw[i])) i++;
    if (i >= raw.length || raw[i] === "]") break;
    if (raw[i] !== "{") break;
    const end = completeJsonObjectEnd(raw, i);
    if (end < 0) break;
    try {
      const obj = JSON.parse(raw.slice(i, end + 1)) as {
        text?: string;
        sourceId?: string;
      };
      const text = String(obj.text ?? "").trim();
      if (text) {
        out.push({
          text,
          sourceId: String(obj.sourceId ?? "").trim(),
        });
      }
    } catch {
      /* skip one bad object */
    }
    i = end + 1;
  }
  return out;
}

function envelopeFromRecovered(
  raw: string,
  recovered: { text: string; sourceId: string }[],
) {
  const needRaw = jsonStringField(raw, "need").toLowerCase();
  const need =
    needRaw === "nothing" || needRaw === "nothing_needed"
      ? ("nothing" as const)
      : needRaw === "answer"
        ? ("answer" as const)
        : undefined;
  const say = jsonStringField(raw, "say").trim();
  const proseRaw =
    need === "nothing" ? "" : say || recovered.map((s) => s.text).join(" ");
  return {
    prose: firstSentences(proseRaw, 3),
    statements: need === "nothing" ? [] : recovered,
    envelope: true as const,
    need,
    reason: jsonStringField(raw, "reason").trim() || undefined,
    headline: jsonStringField(raw, "headline").trim() || undefined,
    rightNow: jsonStringField(raw, "rightNow").trim() || undefined,
  };
}

export function statementsFromModel(answer: string): {
  prose: string;
  statements: { text: string; sourceId: string }[];
  /** True when the model returned the statements envelope it was asked for. */
  envelope: boolean;
  need?: "answer" | "nothing";
  reason?: string;
  headline?: string;
  rightNow?: string;
} {
  const match = answer.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        statements?: Array<{ text?: string; sourceId?: string }>;
        need?: string;
        reason?: string;
        headline?: string;
        say?: string;
        rightNow?: string;
      };
      const needRaw = String(parsed.need ?? "").toLowerCase();
      const need =
        needRaw === "nothing" || needRaw === "nothing_needed"
          ? ("nothing" as const)
          : needRaw === "answer"
            ? ("answer" as const)
            : undefined;
      const statements = (parsed.statements ?? [])
        .map((s) => ({
          text: String(s.text ?? "").trim(),
          sourceId: String(s.sourceId ?? "").trim(),
        }))
        .filter((s) => s.text)
        .slice(0, 6);
      const say = String(parsed.say ?? "").trim();
      const proseRaw =
        need === "nothing"
          ? ""
          : say || statements.map((s) => s.text).join(" ");
      const prose = firstSentences(proseRaw, 3);
      const hasEnvelope =
        Array.isArray(parsed.statements) ||
        Boolean(need) ||
        Boolean(say) ||
        Boolean(parsed.headline);
      if (hasEnvelope) {
        return {
          prose,
          statements: need === "nothing" ? [] : statements,
          envelope: true,
          need,
          reason: String(parsed.reason ?? "").trim() || undefined,
          headline: String(parsed.headline ?? "").trim() || undefined,
          rightNow: String(parsed.rightNow ?? "").trim() || undefined,
        };
      }
    } catch {
      const recovered = statementsFromBrokenEnvelope(answer);
      if (recovered.length) return envelopeFromRecovered(answer, recovered);
    }
  } else {
    const recovered = statementsFromBrokenEnvelope(answer);
    if (recovered.length) return envelopeFromRecovered(answer, recovered);
  }
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  return {
    prose: sentences.join(" "),
    statements: sentences.map((text) => ({ text, sourceId: "" })),
    envelope: false,
  };
}

/** One statement per member record when the model returned none. */
export function statementsFromRecords(
  retrieved: RetrievedSource[],
): { text: string; sourceId: string }[] {
  const out: { text: string; sourceId: string }[] = [];
  for (const s of retrieved) {
    if (s.kind !== "record" && s.kind !== "classification") continue;
    for (const f of recordFactsFromSources([s])) {
      out.push({ text: f.text, sourceId: s.id });
    }
  }
  return out;
}
