import { NextResponse } from "next/server";
import { ensureDocumentEmbeddings } from "@/lib/embeddings";
import { ensureReadyAnswers } from "@/lib/readyAnswers";
import { warmupLuna } from "@/lib/openaiWarmup";
import {
  createSession,
  publicState,
  recordEmbeddings,
  recordWarmup,
} from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";
import type { UtteranceRules } from "@/lib/utteranceRules";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json().catch(() => ({}))) as {
    overlay?: string | null;
    scenarioId?: string;
    injectedDelayMs?: number;
    memberId?: string;
  };
  const disclosureUrl = `${origin}/api/simulated/scripting/disclosures`;
  const discResp = await fetch(disclosureUrl, { cache: "no-store" });
  const discJson = (await discResp.json()) as {
    data?: { requirements?: DisclosureRequirement[] };
  };
  const disclosures = discJson.data?.requirements ?? [];
  const rulesResp = await fetch(
    `${origin}/api/simulated/scripting/utterance-rules`,
    { cache: "no-store" },
  );
  const rulesJson = (await rulesResp.json()) as {
    data?: { rules?: UtteranceRules };
  };
  const session = createSession({
    disclosures,
    disclosureFetch: "GET /api/simulated/scripting/disclosures",
    overlay: body.overlay ?? null,
    scenarioId: body.scenarioId ?? "t01_m2a",
    injectedDelayMs: Number(body.injectedDelayMs) || 0,
    utteranceRules: rulesJson.data?.rules ?? null,
    selectedMemberId: body.memberId || "DEMO-M001",
  });
  void warmupLuna().then((warmup) => {
    recordWarmup(session.sessionId, {
      ok: warmup.ok,
      ms: warmup.ms,
      model: warmup.model,
      at: "call_connect_async",
      httpStatus: warmup.httpStatus,
      error: warmup.error,
    });
  });
  void ensureDocumentEmbeddings(origin).then((info) => {
    recordEmbeddings(session.sessionId, info);
    void ensureReadyAnswers(origin);
  });
  return NextResponse.json({
    session: publicState(session),
    disclosureUrl: "/api/simulated/scripting/disclosures",
  });
}
