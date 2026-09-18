import { NextResponse } from "next/server";
import { saveWrap } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    wrap: string;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  saveWrap(session, body.wrap);
  return NextResponse.json({ session: publicState(session) });
}
