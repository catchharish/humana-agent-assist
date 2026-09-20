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
};

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
        const drug = row.drugName ? String(row.drugName) : "";
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
            `${drug || "Record"} ${status}${where ? ` at ${where}` : ""}`,
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

export function statementsFromModel(answer: string): {
  prose: string;
  statements: { text: string; sourceId: string }[];
} {
  const match = answer.match(/\{[\s\S]*"statements"[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        statements?: Array<{ text?: string; sourceId?: string }>;
      };
      const statements = (parsed.statements ?? [])
        .map((s) => ({
          text: String(s.text ?? "").trim(),
          sourceId: String(s.sourceId ?? "").trim(),
        }))
        .filter((s) => s.text);
      const prose = statements.map((s) => s.text).join(" ");
      return { prose, statements };
    } catch {
      /* fall through */
    }
  }
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    prose: answer.trim(),
    statements: sentences.map((text) => ({ text, sourceId: "" })),
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
