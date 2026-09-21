import { NextResponse } from "next/server";
import { isSafeSessionId } from "@/lib/log";
import { scoreQualityFromLog } from "@/lib/qualityScore";

/** Read-only view of this call's run log for the after-call Quality Score. */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || !isSafeSessionId(sessionId)) {
    return NextResponse.json({ error: "bad_session_id" }, { status: 400 });
  }
  return NextResponse.json({ score: scoreQualityFromLog(sessionId) });
}
