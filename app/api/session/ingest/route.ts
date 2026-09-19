import { NextResponse } from "next/server";
import { prefetchMemberRecords, processTranscriptEvent } from "@/lib/copilot";
import { publishSession } from "@/lib/sse";
import {
  applyAuth,
  beginPause,
  getSession,
  ingestTranscript,
  publicState,
  setIvrHint,
} from "@/lib/session";
import type { AuthResult, MemberBrief } from "@/lib/types";

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
    };
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  const ev = body.event;
  if (ev.type === "transcript" && ev.speaker && ev.stability && ev.text) {
    ingestTranscript(
      session,
      {
        id: ev.id,
        speaker: ev.speaker,
        stability: ev.stability,
        text: ev.text,
        correctsEventId: ev.correctsEventId,
      },
      ev.clientT,
    );
    await processTranscriptEvent(session, origin, {
      id: ev.id,
      speaker: ev.speaker,
      stability: ev.stability,
      text: ev.text,
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
