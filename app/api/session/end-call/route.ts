import { NextResponse } from "next/server";
import { finalizeCall } from "@/lib/copilot";
import { appendJsonl } from "@/lib/log";
import {
  endPause,
  getSession,
  publicState,
  recordActionResult,
} from "@/lib/session";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as { sessionId: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  if (session.callEnd.ended) {
    return NextResponse.json({ session: publicState(session) });
  }
  const telephony = await fetch(
    `${origin}/api/simulated/telephony/hangups`,
    {
      method: "POST",
      cache: "no-store",
    },
  );
  const json = (await telephony.json()) as {
    data?: { hangupId?: string; status?: string };
  };
  if (!telephony.ok || json.data?.status !== "CALL_DISCONNECTED") {
    return NextResponse.json(
      {
        error: "telephony_hangup_failed",
        session: publicState(session),
      },
      { status: 502 },
    );
  }
  const hangupId = json.data.hangupId ?? null;
  endPause(session);
  recordActionResult(session, {
    kind: "call_end",
    title: "Call ended",
    body: `${hangupId ?? "unassigned"}: CALL_DISCONNECTED.`,
    sourceLabel: "System record · telephony · simulated",
    at: new Date().toISOString(),
  });
  appendJsonl(session.sessionId, {
    kind: "telephony_hangup",
    hangupId,
    status: json.data.status,
  });
  await finalizeCall(session, origin, {
    trigger: "telephony_hangup",
    terminal: true,
    hangupId,
  });
  return NextResponse.json({ session: publicState(session) });
}
