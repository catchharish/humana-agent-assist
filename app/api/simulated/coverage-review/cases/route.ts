import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const url = new URL(request.url);
  const memberId = url.searchParams.get("memberId");
  const drug = url.searchParams.get("drug");
  const row = readFixture<{
    caseId: string;
    memberId: string;
    requestedMedication: string;
  }>("coverage.json");
  if (memberId && row.memberId !== memberId) {
    return NextResponse.json(envelope("coverage-review", { error: "not_found" }), {
      status: 404,
    });
  }
  if (
    drug &&
    !row.requestedMedication.toLowerCase().includes(drug.toLowerCase())
  ) {
    return NextResponse.json(envelope("coverage-review", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("coverage-review", row));
}
