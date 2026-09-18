import { NextResponse } from "next/server";
import { applyHumanEditEnrollmentScope } from "@/lib/copilot";
import { appendJsonl } from "@/lib/log";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string;
    medications: string[];
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  applyHumanEditEnrollmentScope(session, body.medications ?? []);
  appendJsonl(session.sessionId, {
    kind: "enrollment_scope_edited",
    medications: session.enrollment.medications,
  });
  return NextResponse.json({ session: publicState(session) });
}
