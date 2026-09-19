import { NextResponse } from "next/server";
import { runAnswerLoop } from "@/lib/answerLoop";
import {
  beginAnswerLoop,
  getSession,
  publicState,
} from "@/lib/session";

/** Runs the real answer loop against this session and paints Now (items 3–4). */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as {
    sessionId?: string;
    question?: string;
  };
  const session = body.sessionId ? getSession(body.sessionId) : undefined;
  if (!session) {
    return NextResponse.json({ error: "session" }, { status: 404 });
  }
  const question = body.question?.trim() || "";
  if (!question) {
    return NextResponse.json({ error: "question" }, { status: 400 });
  }
  const generation = beginAnswerLoop(session, question);
  const result = await runAnswerLoop({
    origin,
    memberId: session.member?.memberId ?? "DEMO-M001",
    planId: session.member?.planId ?? "DEMO-MAPD-001",
    authId: session.auth?.authorizationId ?? "DEMO-AUTH001",
    question,
    loadedSnapshot: true,
    shortAnswers: true,
    serviceTier: "priority",
    nbaParallel: true,
    clockStart: performance.now(),
    generation,
    session,
    identityVerified: session.identityStatus === "VALID",
    preload: false,
    preloadSearchOnly: true,
    searchDelayMs: session.injectedDelayMs || undefined,
    overlay: session.overlay,
    comparisonConsentYes: session.consent.comparison === "absolute_yes",
    dueNow:
      session.pricing === "due_now" ||
      session.pricing === "late_finding" ||
      session.pricing === "paraphrased",
  });
  return NextResponse.json({ session: publicState(session), result });
}
