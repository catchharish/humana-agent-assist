import { NextResponse } from "next/server";
import { getSession, publicState } from "@/lib/session";
import { subscribeSession } from "@/lib/sse";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!sessionId || !session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ session: publicState(session) })}\n\n`,
        ),
      );
      cleanup = subscribeSession(sessionId, controller);
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
