import { NextResponse } from "next/server";
import { getSession, publicState, recordClientPaint } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    eventId: string;
    kind: string;
    tEvent: number;
    tPaint: number;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  recordClientPaint(session, {
    eventId: body.eventId,
    kind: body.kind,
    tEvent: body.tEvent,
    tPaint: body.tPaint,
  });
  return NextResponse.json({ session: publicState(session) });
}
