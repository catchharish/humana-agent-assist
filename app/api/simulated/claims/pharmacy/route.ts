import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const memberId = new URL(request.url).searchParams.get("memberId");
  const claims = readFixture<Array<{ memberId?: string }>>("purchases.json");
  const filtered = memberId
    ? claims.filter((c) => c.memberId === memberId)
    : claims;
  return NextResponse.json(envelope("claims", { claims: filtered }));
}
