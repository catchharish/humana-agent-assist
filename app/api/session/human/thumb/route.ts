import { NextResponse } from "next/server";
import { recordThumb } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    cardId: string;
    kind: string;
    thumb: "up" | "down";
    reason?: string;
    note?: string;
    sources?: string[];
    tookMs?: number;
    advocateDid?: string;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  recordThumb(session, body);
  return NextResponse.json({ session: publicState(session) });
}
