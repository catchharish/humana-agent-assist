/**
 * Compose query router (PLAN item 6). No framework.
 * Multi-source questions run every applicable route. Copilot filters SEARCH.
 */

import { ensureDocumentEmbeddings, rankByQuery } from "@/lib/embeddings";

export type RouteName =
  | "disclosure_registry"
  | "structured_lookup"
  | "governed_derived"
  | "knowledge_search"
  | "partial_withhold";

export type ClaimRow = {
  claimId: string;
  dateOfService?: string;
  drugName?: string;
  memberPaidAmount?: { value: string; currency: string };
  appliedCostShareCategory?: string;
  pharmacy?: { pharmacyId?: string; name?: string };
  quantity?: number;
  daysSupply?: number;
  strength?: string;
};

export type ClassRow = {
  classificationId: string;
  asOfDate?: string;
  pharmacyId?: string;
  pharmacyName?: string;
  networkTier?: string;
};

export type SearchCandidate = {
  id: string;
  kind: string;
  planId: string | null;
  audience?: string;
  effectiveDate?: string;
  text: string;
};

export type RouterEvidence = {
  claims: ClaimRow[];
  classifications: ClassRow[];
  selectedPolicy: SearchCandidate | null;
  refill: Record<string, unknown> | null;
  refillFresh: Record<string, unknown> | null;
  chargesEstablished: boolean;
  causeSupported: boolean;
  missing: string[];
  limitation?: string;
  fast90: {
    articleId: string;
    body: string;
    lineageSourceId: string | null;
    version?: string;
  } | null;
  quotes: Array<Record<string, unknown>>;
  coverage: {
    caseId: string;
    status: string;
    requestedMedication: string;
    determination: null | string;
  } | null;
};

export type RouterResult = {
  routesUsed: RouteName[];
  latencyMs: number;
  retrieved: { id: string; sourceSystem: string }[];
  rejected: { id: string; reason: string }[];
  ranked: { id: string; score: number }[];
  injectedDelayMs: number;
  evidence: RouterEvidence;
};

async function getJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return { ok: true, status: res.status, data: json.data ?? null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function classForClaim(claim: ClaimRow, rows: ClassRow[]): ClassRow | undefined {
  const pid = claim.pharmacy?.pharmacyId;
  return rows.find(
    (r) =>
      (!pid || r.pharmacyId === pid) &&
      (!claim.dateOfService || r.asOfDate === claim.dateOfService),
  );
}

export async function routeQuery(args: {
  origin: string;
  need:
    | "historical_price"
    | "refill_status"
    | "service_education"
    | "prospective_comparison"
    | "coverage_status"
    | "other";
  memberId: string;
  planId: string;
  overlay?: string | null;
  queryText?: string;
  refillMode?: "existing" | "fresh_status";
  injectedDelayMs?: number;
  quotePharmacyId?: string;
  drugName?: string;
  audience?: string;
  asOfDate?: string;
}): Promise<RouterResult> {
  const t0 = performance.now();
  const headers: Record<string, string> = {};
  if (args.overlay) headers["x-demo-overlay"] = args.overlay;
  const routesUsed: RouteName[] = [];
  const retrieved: RouterResult["retrieved"] = [];
  const rejected: RouterResult["rejected"] = [];
  const ranked: RouterResult["ranked"] = [];
  const evidence: RouterEvidence = {
    claims: [],
    classifications: [],
    selectedPolicy: null,
    refill: null,
    refillFresh: null,
    chargesEstablished: false,
    causeSupported: false,
    missing: [],
    fast90: null,
    quotes: [],
    coverage: null,
  };
  const audience = args.audience ?? "pharmacy_ops";

  if (args.need === "refill_status") {
    routesUsed.push("structured_lookup");
    const list = await getJson(
      `${args.origin}/api/simulated/pharmacy/refill-requests?memberId=${encodeURIComponent(args.memberId)}`,
      { headers },
    );
    if (!list.ok || !list.data) {
      evidence.limitation = `Pharmacy refill lookup failed (${list.status}).`;
      evidence.missing.push("refill_request");
    } else {
      const rows = (list.data.requests as Array<Record<string, unknown>>) ?? [];
      const match =
        rows.find((r) =>
          args.drugName
            ? String(r.drugName ?? "")
                .toLowerCase()
                .includes(args.drugName.toLowerCase())
            : true,
        ) ?? rows[0];
      evidence.refill = match ?? null;
      if (match) {
        const rid = String(match.requestId ?? "");
        retrieved.push({ id: rid, sourceSystem: "pharmacy" });
        const pharmacyId = match.pharmacyId as string | undefined;
        if (pharmacyId) {
          const pharmacy = await getJson(
            `${args.origin}/api/simulated/provider/pharmacies/${pharmacyId}`,
            { headers },
          );
          if (pharmacy.ok) {
            retrieved.push({ id: pharmacyId, sourceSystem: "provider" });
            evidence.refill = { ...match, provider: pharmacy.data };
          }
        }
        if (args.refillMode === "fresh_status" && rid) {
          const fresh = await getJson(
            `${args.origin}/api/simulated/pharmacy/refill-requests/${rid}/status`,
            { headers },
          );
          if (!fresh.ok || !fresh.data) {
            evidence.limitation = `Fresh refill status failed (${fresh.status}).`;
            evidence.missing.push("refill_status");
          } else {
            evidence.refillFresh = fresh.data;
            retrieved.push({ id: `${rid}:status`, sourceSystem: "pharmacy" });
          }
        }
      }
    }
  }

  if (args.need === "historical_price") {
    routesUsed.push("structured_lookup");
    const claims = await getJson(
      `${args.origin}/api/simulated/claims/pharmacy?memberId=${args.memberId}`,
      { headers },
    );
    evidence.claims = (claims.data?.claims as ClaimRow[]) ?? [];
    if (!claims.ok) {
      evidence.limitation = `Claims lookup failed (${claims.status}).`;
    }
    for (const c of evidence.claims) {
      retrieved.push({ id: c.claimId, sourceSystem: "claims" });
    }
    const dates = [
      ...new Set(evidence.claims.map((c) => c.dateOfService).filter(Boolean)),
    ] as string[];
    const classRows: ClassRow[] = [];
    for (const asOf of dates.length ? dates : [args.asOfDate ?? ""]) {
      const q = asOf
        ? `?asOfDate=${encodeURIComponent(asOf)}`
        : "";
      const net = await getJson(
        `${args.origin}/api/simulated/benefits/plans/${args.planId}/pharmacy-network${q}`,
        { headers },
      );
      classRows.push(...((net.data?.rows as ClassRow[]) ?? []));
    }
    evidence.classifications = classRows;
    for (const row of evidence.classifications) {
      retrieved.push({ id: row.classificationId, sourceSystem: "benefits" });
    }
    await getJson(
      `${args.origin}/api/simulated/benefits/plans/${args.planId}/cost-share`,
      { headers },
    );

    const queryText = args.queryText?.trim() ?? "";
    if (!queryText) {
      routesUsed.push("partial_withhold");
      evidence.missing.push("query_text");
    } else {
      routesUsed.push("knowledge_search");
      if (args.injectedDelayMs) {
        headers["x-demo-delay-ms"] = String(args.injectedDelayMs);
      }
      await ensureDocumentEmbeddings(args.origin);
      const search = await getJson(
        `${args.origin}/api/simulated/scripting/knowledge/search`,
        { method: "POST", headers },
      );
      const candidates = (search.data?.candidates as SearchCandidate[]) ?? [];
      const remaining: SearchCandidate[] = [];
      const asOf =
        args.asOfDate ||
        dates.sort().slice(-1)[0] ||
        "2026-09-17";
      for (const cand of candidates) {
        if (cand.planId && cand.planId !== args.planId) {
          rejected.push({ id: cand.id, reason: "rejected: wrong plan" });
          continue;
        }
        if (cand.audience && cand.audience !== audience) {
          rejected.push({ id: cand.id, reason: "rejected: wrong audience" });
          continue;
        }
        if (cand.effectiveDate && cand.effectiveDate > asOf) {
          rejected.push({ id: cand.id, reason: "rejected: not yet effective" });
          continue;
        }
        remaining.push(cand);
      }
      const order = await rankByQuery(
        queryText,
        remaining.map((c) => c.id),
      );
      ranked.push(...order);
      const byId = new Map(remaining.map((c) => [c.id, c]));
      const policies = order
        .map((r) => byId.get(r.id))
        .filter((c): c is SearchCandidate => Boolean(c && c.kind === "policy"));
      evidence.selectedPolicy = policies[0] ?? null;
      if (evidence.selectedPolicy) {
        retrieved.push({
          id: evidence.selectedPolicy.id,
          sourceSystem: "scripting",
        });
      } else {
        evidence.missing.push("governing_policy");
      }
    }

    evidence.chargesEstablished = evidence.claims.some(
      (c) => Boolean(c.memberPaidAmount?.value) && Boolean(c.drugName),
    );
    const unmatched = evidence.claims.filter(
      (c) => !classForClaim(c, evidence.classifications),
    );
    for (const c of unmatched) {
      evidence.missing.push(`classification:${c.claimId}`);
    }
    evidence.causeSupported =
      evidence.chargesEstablished &&
      unmatched.length === 0 &&
      Boolean(evidence.selectedPolicy);
    if (!evidence.causeSupported) {
      routesUsed.push("partial_withhold");
    }
  }

  if (args.need === "service_education") {
    routesUsed.push("governed_derived");
    const article = await getJson(
      `${args.origin}/api/simulated/scripting/articles/DEMO-FAST90-v1`,
      { headers },
    );
    if (!article.ok || !article.data) {
      evidence.limitation = `Derived 90-day article unavailable (${article.status}).`;
      evidence.missing.push("fast90");
    } else {
      const data = article.data;
      const articleId = data.articleId as string | undefined;
      if (!articleId) {
        evidence.limitation = "Derived 90-day article missing id.";
        evidence.missing.push("fast90");
      } else {
        evidence.fast90 = {
          articleId,
          body: String(data.body ?? ""),
          lineageSourceId: (data.lineageSourceId as string | null) ?? null,
          version: data.version as string | undefined,
        };
        retrieved.push({ id: articleId, sourceSystem: "scripting" });
        if (evidence.fast90.lineageSourceId) {
          retrieved.push({
            id: evidence.fast90.lineageSourceId,
            sourceSystem: "scripting",
          });
        }
      }
    }
  }

  if (args.need === "prospective_comparison") {
    routesUsed.push("structured_lookup");
    if (args.injectedDelayMs) {
      headers["x-demo-delay-ms"] = String(args.injectedDelayMs);
    }
    const qPath = args.quotePharmacyId
      ? `${args.origin}/api/simulated/pharmacy/quotes?pharmacyId=${encodeURIComponent(args.quotePharmacyId)}`
      : `${args.origin}/api/simulated/pharmacy/quotes`;
    const q = await getJson(qPath, { headers });
    if (!q.ok) {
      evidence.limitation = `Quote lookup failed (${q.status}).`;
    }
    evidence.quotes = (q.data?.quotes as Array<Record<string, unknown>>) ?? [];
    for (const row of evidence.quotes) {
      retrieved.push({
        id: String(row.quoteId),
        sourceSystem: "pharmacy",
      });
    }
  }

  if (args.need === "coverage_status") {
    routesUsed.push("structured_lookup");
    const q = new URLSearchParams({ memberId: args.memberId });
    if (args.drugName) q.set("drug", args.drugName);
    const row = await getJson(
      `${args.origin}/api/simulated/coverage-review/cases?${q.toString()}`,
      { headers },
    );
    if (!row.ok || !row.data) {
      evidence.limitation = `Coverage case lookup failed (${row.status || 404}).`;
      evidence.missing.push("coverage_case");
    } else if (row.data.error) {
      evidence.limitation = "No coverage case for this member and medication.";
      evidence.missing.push("coverage_case");
    } else {
      const data = row.data;
      if (!data.caseId || !data.status) {
        evidence.limitation = "Coverage case payload incomplete.";
        evidence.missing.push("coverage_case");
      } else {
        evidence.coverage = {
          caseId: String(data.caseId),
          status: String(data.status),
          requestedMedication: String(data.requestedMedication ?? ""),
          determination:
            data.determination === null || data.determination === undefined
              ? null
              : String(data.determination),
        };
        retrieved.push({
          id: evidence.coverage.caseId,
          sourceSystem: "coverage-review",
        });
      }
    }
  }

  return {
    routesUsed,
    latencyMs: performance.now() - t0,
    retrieved,
    rejected,
    ranked,
    injectedDelayMs: args.injectedDelayMs ?? 0,
    evidence,
  };
}
