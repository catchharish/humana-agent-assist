import { NextResponse } from "next/server";
import { resumeParkedNeed } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";
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
  await resumeParkedNeed(session, origin, body.kind);
  return NextResponse.json({ session: publicState(session) });
}
