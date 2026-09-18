import { NextResponse } from "next/server";
import { appendJsonl } from "@/lib/log";
import { getSession, publicState } from "@/lib/session";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const body = (await request.json()) as {
    sessionId: string;
    token: string;
  };
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "unknown_session" }, { status: 404 });
  }
  if (session.consent.enrollment !== "absolute_yes") {
    return NextResponse.json(
      { error: "no_absolute_yes", session: publicState(session) },
      { status: 400 },
    );
  }
  if (session.enrollment.withdrawn) {
    return NextResponse.json(
      { error: "enrollment_withdrawn", session: publicState(session) },
      { status: 400 },
    );
  }
  const scope = session.enrollment.medications;
  const post = await fetch(`${origin}/api/simulated/pharmacy/enrollments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-enrollment-token": body.token,
      "x-session-id": body.sessionId,
    },
    body: JSON.stringify({
      memberId: session.member?.memberId,
      medicationScope: scope,
    }),
  });
  const json = (await post.json()) as {
    data?: { enrollmentId?: string; medicationScope?: string[] };
    error?: string;
  };
  if (!post.ok) {
    appendJsonl(session.sessionId, {
      kind: "enrollment_submit_rejected",
      status: post.status,
      error: json.error,
    });
    return NextResponse.json(
      { error: json.error ?? "submit_failed", session: publicState(session) },
      { status: post.status },
    );
  }
  const id = json.data?.enrollmentId;
  if (!id) {
    appendJsonl(session.sessionId, {
      kind: "enrollment_submit_rejected",
      error: "missing_enrollment_id",
    });
    return NextResponse.json(
      { error: "missing_enrollment_id", session: publicState(session) },
      { status: 502 },
    );
  }
  const verify = await fetch(
    `${origin}/api/simulated/pharmacy/enrollments/${id}`,
    {
      cache: "no-store",
      headers: session.overlay
        ? { "x-demo-overlay": session.overlay }
        : undefined,
    },
  );
  const verified = (await verify.json()) as {
    data?: { medicationScope?: string[]; enrollmentId?: string };
  };
  const returned = verified.data?.medicationScope ?? [];
  const expected = [...scope].map((s) => s.toLowerCase()).sort();
  const got = [...returned].map((s) => s.toLowerCase()).sort();
  const scopeOk =
    expected.length === got.length && expected.every((x, i) => x === got[i]);
  const returnedId = verified.data?.enrollmentId;
  if (!returnedId) {
    return NextResponse.json(
      { error: "verify_incomplete", session: publicState(session) },
      { status: 502 },
    );
  }
  session.enrollment.submitted = true;
  session.enrollment.resultId = returnedId;
  session.enrollment.returnedScope = returned;
  session.enrollment.scopeOk = scopeOk;
  session.nowCard = {
    title: scopeOk ? "Enrollment result" : "Enrollment scope mismatch",
    body: scopeOk
      ? `${session.enrollment.resultId} is active for ${scope.join(", ")}. Today's recorded refill and plan membership are unchanged. This is not an order or automatic refill.`
      : `Returned scope ${returned.join(", ") || "empty"} does not match the confirmed request ${scope.join(", ")}. Not a success.`,
    sourceLabel: "System record · pharmacy · simulated",
  };
  if (!scopeOk) {
    session.recommendation = {
      kind: "lead_review",
      title: "Lead review — wrong returned scope",
      body: "The enrollment record does not match the confirmed medication scope. Offer a lead review. Do not treat this as success.",
      sourceLabel: "System record · pharmacy · simulated",
      status: "pending",
    };
  }
  upsertNeedResolved(session);
  appendJsonl(session.sessionId, {
    kind: "enrollment_result",
    enrollmentId: session.enrollment.resultId,
    returnedScope: returned,
    scopeOk,
  });
  return NextResponse.json({ session: publicState(session) });
}

function upsertNeedResolved(
  session: import("@/lib/types").SessionState,
) {
  const need = session.needs.find((n) => n.kind === "service_election");
  if (need) need.status = session.enrollment.scopeOk ? "resolved" : "unresolved_gap";
}
