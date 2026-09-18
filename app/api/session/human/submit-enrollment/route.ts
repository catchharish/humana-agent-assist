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
  const id = json.data?.enrollmentId ?? "DEMO-ENR001";
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
  session.enrollment.submitted = true;
  session.enrollment.resultId = verified.data?.enrollmentId ?? id;
  session.enrollment.returnedScope = returned;
  session.enrollment.scopeOk = scopeOk;
  session.nowCard = {
    title: scopeOk ? "Enrollment result" : "Enrollment scope mismatch",
    body: scopeOk
      ? `${session.enrollment.resultId} is active for ${scope.join(", ") || "the confirmed scope"}. Today's recorded refill and plan membership are unchanged. This is not an order or automatic refill.`
      : `Returned scope ${(returned.join(", ") || "empty")} does not match the confirmed request ${scope.join(", ") || "(empty)"}. Not a success.`,
    sourceLabel: "System record · pharmacy · simulated",
  };
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
