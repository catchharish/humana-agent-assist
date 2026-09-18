import { NextResponse } from "next/server";
import { getSession, publicState } from "@/lib/session";
import { mintEnrollmentToken } from "@/lib/enrollmentToken";
import { appendJsonl } from "@/lib/log";

/** Human Confirm only. Not registered as an AI tool. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    scope?: { medications?: string[] };
  };
  const session = body.sessionId ? getSession(body.sessionId) : undefined;
  if (!body.sessionId || !session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const medications = body.scope?.medications ?? [];
  if (medications.length === 0) {
    return NextResponse.json({ error: "empty_scope" }, { status: 400 });
  }
  if (session.consent.enrollment !== "absolute_yes") {
    return NextResponse.json({ error: "no_absolute_yes" }, { status: 400 });
  }
  if (session.enrollment.withdrawn) {
    return NextResponse.json({ error: "enrollment_withdrawn" }, { status: 400 });
  }
  const token = mintEnrollmentToken(body.sessionId, { medications });
  session.enrollment.confirmed = true;
  appendJsonl(body.sessionId, {
    kind: "enrollment_token_minted",
    scope: { medications },
  });
  return NextResponse.json({
    token,
    scope: { medications },
    session: publicState(session),
  });
}
