import { NextResponse } from "next/server";
import { endPause, getSession, publicState } from "@/lib/session";

/** Resume only lifts the presenter pause. It does not authorize identity. */

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  endPause(session);
  return NextResponse.json({ session: publicState(session) });
}
