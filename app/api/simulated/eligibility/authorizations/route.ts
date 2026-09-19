import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

type AuthFixture = {
  authorizationId: string;
  memberId: string;
  role: string;
  decision: string;
  permittedScopes: string[];
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { memberId?: string };
  const rows = readFixture<AuthFixture[]>("authorizations.json");
  const memberId = body.memberId || "DEMO-M001";
  const fixture = rows.find((r) => r.memberId === memberId) ?? rows[0];
  return NextResponse.json(
    envelope("eligibility", {
      authorizationId: fixture.authorizationId,
      memberId: fixture.memberId,
      role: fixture.role,
      decision: fixture.decision,
      permittedScopes: fixture.permittedScopes,
    }),
  );
}
