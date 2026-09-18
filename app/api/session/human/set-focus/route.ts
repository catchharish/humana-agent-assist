import { NextResponse } from "next/server";
import { promoteHistorical } from "@/lib/copilot";
import { getSession, publicState, setFocus } from "@/lib/session";
import type { NeedKind } from "@/lib/types";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as {
    sessionId: string;
    kind: NeedKind;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  if (body.kind === "historical_price") {
    await promoteHistorical(session, origin);
  } else {
    const need = session.needs.find((n) => n.kind === body.kind);
    setFocus(session, body.kind, need?.flowStep ?? "advocate-selected focus");
    if (need?.answer) {
      session.nowCard = {
        title: need.answer.title,
        body: need.answer.body,
        sourceLabel: need.answer.sourceLabel,
      };
    }
  }
  return NextResponse.json({ session: publicState(session) });
}
