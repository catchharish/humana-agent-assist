import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Policy = {
  policyId: string;
  planId: string;
  audience: string;
  effectiveDate: string;
  body: string;
};

type Article = {
  articleId: string;
  body: string;
  lineageSourceId: string | null;
};

/** Raw candidates only. Copilot filters. Includes DEMO-POLICY-OTHER-v1. */
export async function POST(request: Request) {
  await applyDemoHeaders(request);
  const policies = readFixture<Policy[]>("policies.json");
  const articles = readFixture<Article[]>("articles.json");
  const candidates = [
    ...policies.map((p) => ({
      id: p.policyId,
      kind: "policy",
      planId: p.planId,
      audience: p.audience,
      effectiveDate: p.effectiveDate,
      text: p.body,
    })),
    ...articles.map((a) => ({
      id: a.articleId,
      kind: "article",
      planId: null,
      audience: "pharmacy_ops",
      effectiveDate: "2026-01-01",
      text: a.body,
      lineageSourceId: a.lineageSourceId,
    })),
  ];
  return NextResponse.json(envelope("scripting", { candidates }));
}
