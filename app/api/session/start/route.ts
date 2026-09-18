import { NextResponse } from "next/server";
import { ensureDocumentEmbeddings } from "@/lib/embeddings";
import { warmupLuna } from "@/lib/openaiWarmup";
import {
  createSession,
  publicState,
  recordEmbeddings,
  recordWarmup,
} from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json().catch(() => ({}))) as {
    overlay?: string | null;
    scenarioId?: string;
    injectedDelayMs?: number;
  };
  const disclosureUrl = `${origin}/api/simulated/scripting/disclosures`;
  const discResp = await fetch(disclosureUrl, { cache: "no-store" });
  const discJson = (await discResp.json()) as {
    data?: { requirements?: DisclosureRequirement[] };
  };
  const disclosures = discJson.data?.requirements ?? [];
  const session = createSession({
    disclosures,
    disclosureFetch: "GET /api/simulated/scripting/disclosures",
    overlay: body.overlay ?? null,
    scenarioId: body.scenarioId ?? "t01_m2a",
    injectedDelayMs: Number(body.injectedDelayMs) || 0,
  });
  void warmupLuna().then((warmup) => {
    recordWarmup(session.sessionId, {
      ok: warmup.ok,
      ms: warmup.ms,
      model: warmup.model,
      at: "call_connect_async",
    });
  });
  void ensureDocumentEmbeddings(origin).then((info) => {
    recordEmbeddings(session.sessionId, info);
  });
  return NextResponse.json({
    session: publicState(session),
    disclosureUrl: "/api/simulated/scripting/disclosures",
  });
}
