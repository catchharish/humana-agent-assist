import { NextResponse } from "next/server";
import { executeTransfer } from "@/lib/copilot";
import { appendJsonl } from "@/lib/log";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as { sessionId: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const result = await executeTransfer(session, origin);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, session: publicState(session) },
      { status: 400 },
    );
  }
  appendJsonl(session.sessionId, {
    kind: "transfer_connection",
    transferId: session.transfer.transferId,
    connectionStatus: session.transfer.connectionStatus,
  });
  return NextResponse.json({ session: publicState(session) });
}
