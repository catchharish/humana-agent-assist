import { NextResponse } from "next/server";
import { confirmDisposition } from "@/lib/copilot";
import { appendJsonl } from "@/lib/log";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    code: string;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  confirmDisposition(session, body.code);
  appendJsonl(session.sessionId, {
    kind: "disposition_confirmed",
    code: session.disposition.confirmed,
    recommended: session.disposition.recommended,
  });
  return NextResponse.json({ session: publicState(session) });
}
