import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

type MemberFixture = {
  memberId: string;
  name: { given: string; family: string };
  planId: string;
  lineOfBusiness: string;
  eligibilityStatus: string;
};

type AuthFixture = {
  authorizationId: string;
  memberId: string;
  decision: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await context.params;
  const authHeader = request.headers.get("x-authorization-id");
  const auths = readFixture<AuthFixture[]>("authorizations.json");
  const fixtureAuth = auths.find((a) => a.authorizationId === authHeader);
  if (!fixtureAuth || fixtureAuth.decision.toLowerCase() !== "valid") {
    return NextResponse.json(
      envelope("eligibility", { error: "unauthorized" }),
      { status: 403 },
    );
  }
  if (fixtureAuth.memberId !== memberId) {
    return NextResponse.json(
      envelope("eligibility", { error: "unauthorized" }),
      { status: 403 },
    );
  }
  const members = readFixture<MemberFixture[]>("members.json");
  const fixture = members.find((m) => m.memberId === memberId);
  if (!fixture) {
    return NextResponse.json(
      envelope("eligibility", { error: "not_found" }),
      { status: 404 },
    );
  }
  return NextResponse.json(
    envelope("eligibility", {
      memberId: fixture.memberId,
      name: fixture.name,
      planId: fixture.planId,
      lineOfBusiness: fixture.lineOfBusiness,
      eligibilityStatus: fixture.eligibilityStatus,
    }),
  );
}
