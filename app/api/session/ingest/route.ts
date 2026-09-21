import { NextResponse } from "next/server";
import { prefetchMemberRecords, processTranscriptEvent } from "@/lib/copilot";
import { publishSession } from "@/lib/sse";
import {
  applyAuth,
  beginPause,
  getSession,
  ingestTranscript,
  markEventApplied,
  publicState,
  setIvrHint,
} from "@/lib/session";
import {
  expireStaleLookups,
  queueAdvocateLine,
  shouldDeferAdvocateLine,
  takeReadyAdvocateLines,
} from "@/lib/lookupProgress";
import type { AuthResult, MemberBrief } from "@/lib/types";

const flushers = new Map<string, ReturnType<typeof setInterval>>();

function ensureAdvocateFlush(sessionId: string, origin: string) {
  if (flushers.has(sessionId)) return;
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const session = getSession(sessionId);
        if (!session) {
          clearInterval(t);
          flushers.delete(sessionId);
          return;
        }
        expireStaleLookups(session);
        const ready = takeReadyAdvocateLines(session);
        for (const line of ready) {
          ingestTranscript(session, {
            id: line.id,
            speaker: "advocate",
            stability: line.stability,
            text: line.text,
            inputSource: "stream",
          });
          await processTranscriptEvent(session, origin, {
            id: line.id,
            speaker: "advocate",
            stability: line.stability,
            text: line.text,
          });
        }
        if (ready.length) publishSession(session);
        if (!session.heldAdvocateLines.length) {
          clearInterval(t);
          flushers.delete(sessionId);
        }
      } finally {
        busy = false;
      }
    })();
  }, 200);
  flushers.set(sessionId, t);
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as {
    sessionId: string;
    event: {
      id: string;
      type: string;
      name?: string;
      speaker?: string;
      stability?: "partial" | "final" | "corrected" | "uncertain";
      text?: string;
      correctsEventId?: string;
      pauseLabel?: string;
      offsetMs?: number;
      clientT?: number;
      inputSource?: "stream" | "presenter_typed" | "presenter_picked";
      truncatedFrom?: number;
    };
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const ev = body.event;
  if (ev.type === "transcript" && ev.speaker && ev.stability && ev.text) {
    const presenterSource =
      ev.inputSource === "presenter_typed" ||
      ev.inputSource === "presenter_picked";
    if (presenterSource && (session.callEnd.finalizing || session.callEnd.ended)) {
      return NextResponse.json(
        { error: "call_ending_or_ended" },
        { status: 409 },
      );
    }
    if (
      presenterSource &&
      ev.speaker === "member" &&
      session.identityStatus !== "VALID"
    ) {
      return NextResponse.json(
        { error: "presenter_member_input_requires_authorization" },
        { status: 403 },
      );
    }
    const originalLength = ev.text.length;
    const text = presenterSource
      ? ev.text.slice(0, session.presenterInput.maxLength)
      : ev.text;
    if (presenterSource && !text.trim()) {
      return NextResponse.json({ session: publicState(session) });
    }
    if (presenterSource) {
      beginPause(
        session,
        ev.inputSource === "presenter_picked"
          ? "Presenter question inserted — stream paused"
          : `Presenter ${ev.speaker} line inserted — stream paused`,
      );
      session.presenterInput = {
        ...session.presenterInput,
        lastSource:
          ev.inputSource === "presenter_picked"
            ? "presenter_picked"
            : "presenter_typed",
        truncatedFrom:
          originalLength > session.presenterInput.maxLength
            ? originalLength
            : null,
      };
    }
    if (
      shouldDeferAdvocateLine(session, {
        id: ev.id,
        speaker: ev.speaker,
        stability: ev.stability,
        text,
      })
    ) {
      queueAdvocateLine(session, {
        id: ev.id,
        text,
        stability: ev.stability === "corrected" ? "corrected" : "final",
      });
      markEventApplied(session, ev.id);
      ensureAdvocateFlush(session.sessionId, origin);
      publishSession(session);
      return NextResponse.json({ session: publicState(session) });
    }
    ingestTranscript(
      session,
      {
        id: ev.id,
        speaker: ev.speaker,
        stability: ev.stability,
        text,
        correctsEventId: ev.correctsEventId,
        inputSource: ev.inputSource ?? "stream",
        truncatedFrom:
          originalLength > text.length ? originalLength : ev.truncatedFrom,
      },
      ev.clientT,
    );
    await processTranscriptEvent(session, origin, {
      id: ev.id,
      speaker: ev.speaker,
      stability: ev.stability,
      text,
      offsetMs: ev.offsetMs,
    });
  } else if (ev.type === "pause_gate") {
    beginPause(session, ev.pauseLabel ?? "presenter_gate");
  } else if (ev.type === "system" && ev.name === "ivr_hint") {
    const ivr = await fetch(
      `${origin}/api/simulated/telephony/ivr/current-hint`,
      { cache: "no-store" },
    );
    const json = (await ivr.json()) as { data?: { ivrReason?: string } };
    if (json.data?.ivrReason) {
      setIvrHint(session, json.data.ivrReason);
    } else {
      session.nowCard = {
        title: "IVR hint limitation",
        body: "Telephony did not return an IVR reason. Call type is not inferred.",
        sourceLabel: "System record · telephony · simulated",
      };
    }
  } else if (ev.type === "system" && ev.name === "authorization") {
    const authResp = await fetch(
      `${origin}/api/simulated/eligibility/authorizations`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId: session.selectedMemberId }),
      },
    );
    const authJson = (await authResp.json()) as { data?: AuthResult };
    const auth = authJson.data;
    if (auth) {
      let member: MemberBrief | null = null;
      if (auth.decision.toLowerCase() === "valid") {
        const memberResp = await fetch(
          `${origin}/api/simulated/eligibility/members/${auth.memberId}`,
          {
            cache: "no-store",
            headers: { "x-authorization-id": auth.authorizationId },
          },
        );
        if (memberResp.ok) {
          const memberJson = (await memberResp.json()) as { data?: MemberBrief };
          member = memberJson.data ?? null;
        }
      }
      applyAuth(session, auth, member);
      if (auth.decision.toLowerCase() === "valid") {
        await prefetchMemberRecords(session, origin);
      }
    }
  }
  publishSession(session);
  return NextResponse.json({ session: publicState(session) });
}
