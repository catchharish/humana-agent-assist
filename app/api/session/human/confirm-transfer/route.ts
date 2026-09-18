import { NextResponse } from "next/server";
import { confirmTransferDestination } from "@/lib/copilot";
import { appendJsonl } from "@/lib/log";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  await confirmTransferDestination(session);
  appendJsonl(session.sessionId, {
    kind: "human_confirm_transfer_destination",
    destination: "Coverage Review",
  });
  return NextResponse.json({ session: publicState(session) });
}
