import type { SessionState } from "@/lib/types";
import { publicState } from "@/lib/session";

const subs = new Map<string, Set<ReadableStreamDefaultController>>();

export function subscribeSession(
  sessionId: string,
  controller: ReadableStreamDefaultController,
) {
  let set = subs.get(sessionId);
  if (!set) {
    set = new Set();
    subs.set(sessionId, set);
  }
  set.add(controller);
  return () => {
    set?.delete(controller);
    if (set && set.size === 0) subs.delete(sessionId);
  };
}

export function publishSession(session: SessionState) {
  const set = subs.get(session.sessionId);
  if (!set || set.size === 0) return;
  const chunk = new TextEncoder().encode(
    `data: ${JSON.stringify({ session: publicState(session) })}\n\n`,
  );
  for (const c of set) {
    try {
      c.enqueue(chunk);
    } catch {
      set.delete(c);
    }
  }
}
