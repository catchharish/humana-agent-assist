import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

type AuthFixture = {
  authorizationId: string;
  memberId: string;
  role: string;
  decision: string;
  permittedScopes: string[];
};

export async function POST() {
  const fixture = readFixture<AuthFixture>("auth.json");
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
