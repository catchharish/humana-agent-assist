import { NextResponse } from "next/server";
import { applyHumanObjection } from "@/lib/copilot";
import { appendJsonl } from "@/lib/log";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  applyHumanObjection(session);
  appendJsonl(session.sessionId, {
    kind: "human_use_objection",
    source: "DEMO-OBJECTION-RETAIL-v1",
  });
  return NextResponse.json({ session: publicState(session) });
}
