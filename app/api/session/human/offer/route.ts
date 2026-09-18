import { NextResponse } from "next/server";
import { applyHumanDismiss, applyHumanOffer } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";
import { appendJsonl } from "@/lib/log";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    decision: "offer" | "dismiss";
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  if (body.decision === "offer") applyHumanOffer(session);
  else applyHumanDismiss(session);
  appendJsonl(session.sessionId, {
    kind: "human_nba",
    decision: body.decision,
    note: "Click is not service discussion and does not create closing v2.",
  });
  return NextResponse.json({ session: publicState(session) });
}
