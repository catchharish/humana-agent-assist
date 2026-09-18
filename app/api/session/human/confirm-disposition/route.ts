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
  const result = confirmDisposition(session, body.code);
  appendJsonl(session.sessionId, {
    kind: result.ok ? "disposition_confirmed" : "disposition_refused",
    code: session.disposition.confirmed,
    recommended: session.disposition.recommended,
    reason: result.reason ?? null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "refused", session: publicState(session) },
      { status: 400 },
    );
  }
  return NextResponse.json({ session: publicState(session) });
}
