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

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  return res.json() as Promise<{ data?: Record<string, unknown> }>;
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

  if (args.need === "refill_status") {
    routesUsed.push("structured_lookup");
    const existing = await getJson(
      `${args.origin}/api/simulated/pharmacy/refill-requests/DEMO-RF001`,
      { headers },
    );
    evidence.refill = existing.data ?? null;
    const rid = (existing.data?.requestId as string) || "DEMO-RF001";
    retrieved.push({ id: rid, sourceSystem: "pharmacy" });
    const pharmacyId = existing.data?.pharmacyId as string | undefined;
    if (pharmacyId) {
      const pharmacy = await getJson(
        `${args.origin}/api/simulated/provider/pharmacies/${pharmacyId}`,
        { headers },
      );
      retrieved.push({
        id: pharmacyId,
        sourceSystem: "provider",
      });
      if (evidence.refill) {
        evidence.refill = { ...evidence.refill, provider: pharmacy.data };
      }
    }
    if (args.refillMode === "fresh_status") {
      const fresh = await getJson(
        `${args.origin}/api/simulated/pharmacy/refill-requests/DEMO-RF001/status`,
        { headers },
      );
      evidence.refillFresh = fresh.data ?? null;
      retrieved.push({ id: `${rid}:status`, sourceSystem: "pharmacy" });
    }
  }

  if (args.need === "historical_price") {
    routesUsed.push("structured_lookup");
    const claims = await getJson(
      `${args.origin}/api/simulated/claims/pharmacy?memberId=${args.memberId}`,
      { headers },
    );
    evidence.claims = (claims.data?.claims as ClaimRow[]) ?? [];
    for (const c of evidence.claims) {
      retrieved.push({ id: c.claimId, sourceSystem: "claims" });
    }
    const net = await getJson(
      `${args.origin}/api/simulated/benefits/plans/${args.planId}/pharmacy-network`,
      { headers },
    );
    evidence.classifications = (net.data?.rows as ClassRow[]) ?? [];
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
      for (const cand of candidates) {
        if (cand.planId && cand.planId !== args.planId) {
          rejected.push({ id: cand.id, reason: "rejected: wrong plan" });
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
      }
    }

    const hasC0818 = evidence.claims.some((c) => c.claimId === "DEMO-C0818");
    const hasC0916 = evidence.claims.some((c) => c.claimId === "DEMO-C0916");
    evidence.chargesEstablished = hasC0818 && hasC0916;
    const hasNet0818 = evidence.classifications.some(
      (r) => r.classificationId === "DEMO-NET0818",
    );
    const hasNet0916 = evidence.classifications.some(
      (r) => r.classificationId === "DEMO-NET0916",
    );
    const hasCost = evidence.selectedPolicy?.id === "DEMO-POLICY-COST-v1";
    if (!hasC0818) evidence.missing.push("DEMO-C0818");
    if (!hasC0916) evidence.missing.push("DEMO-C0916");
    if (!hasNet0818) evidence.missing.push("DEMO-NET0818");
    if (!hasNet0916) evidence.missing.push("DEMO-NET0916");
    if (!hasCost) evidence.missing.push("DEMO-POLICY-COST-v1");
    evidence.causeSupported =
      evidence.chargesEstablished && hasNet0818 && hasNet0916 && hasCost;
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
    const data = article.data ?? {};
    evidence.fast90 = {
      articleId: (data.articleId as string) || "DEMO-FAST90-v1",
      body: (data.body as string) || "",
      lineageSourceId: (data.lineageSourceId as string | null) ?? "DEMO-SERVICE-v1",
      version: data.version as string | undefined,
    };
    retrieved.push({ id: "DEMO-FAST90-v1", sourceSystem: "scripting" });
    if (evidence.fast90.lineageSourceId) {
      retrieved.push({
        id: evidence.fast90.lineageSourceId,
        sourceSystem: "scripting",
      });
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
    const q = await getJson(qPath, {
      headers,
    });
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
    const row = await getJson(
      `${args.origin}/api/simulated/coverage-review/cases/DEMO-CVR001`,
      { headers },
    );
    const data = row.data ?? {};
    evidence.coverage = {
      caseId: String(data.caseId ?? "DEMO-CVR001"),
      status: String(data.status ?? "pending_review"),
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
