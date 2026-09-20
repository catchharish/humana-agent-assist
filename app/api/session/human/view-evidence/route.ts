import { NextResponse } from "next/server";
import { viewEvidence } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId: string; sourceId?: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  viewEvidence(session, body.sourceId);
  return NextResponse.json({ session: publicState(session) });
}
