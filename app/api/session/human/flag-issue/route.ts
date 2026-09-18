import { NextResponse } from "next/server";
import { flagIssue } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId: string; note?: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  flagIssue(session, body.note ?? "flagged");
  return NextResponse.json({ session: publicState(session) });
}
