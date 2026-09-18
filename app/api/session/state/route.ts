import { NextResponse } from "next/server";
import { getSession, publicState } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  return NextResponse.json({ session: publicState(session) });
}
