import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const members = readFixture<
    Array<{
      memberId: string;
      name: { given: string; family: string };
      planId: string;
    }>
  >("members.json");
  return NextResponse.json(
    envelope(
      "eligibility",
      members.map((m) => ({
        memberId: m.memberId,
        given: m.name.given,
        family: m.name.family,
        planId: m.planId,
      })),
    ),
  );
}
