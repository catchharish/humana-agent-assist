import { NextResponse } from "next/server";
import { retryLastAnswer } from "@/lib/copilot";
import { getSession, publicState } from "@/lib/session";
import { appendJsonl } from "@/lib/log";

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId: string };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const origin = new URL(request.url).origin;
  appendJsonl(session.sessionId, {
    kind: "human_retry_answer",
    question: session.lastAnswerQuestion,
    cause: session.nowCard.retryCause ?? null,
  });
  await retryLastAnswer(session, origin);
  return NextResponse.json({ session: publicState(session) });
}
