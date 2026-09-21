import { NextResponse } from "next/server";
import { promoteRecommendationKind } from "@/lib/nba";
import { getSession, publicState } from "@/lib/session";
import { appendJsonl } from "@/lib/log";
import { publishSession } from "@/lib/sse";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    kind: string;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const ok = promoteRecommendationKind(session, body.kind);
  if (ok) {
    appendJsonl(session.sessionId, {
      kind: "human_nba",
      decision: "promote",
      tipKind: body.kind,
    });
    publishSession(session);
  }
  return NextResponse.json({ session: publicState(session), ok });
}
