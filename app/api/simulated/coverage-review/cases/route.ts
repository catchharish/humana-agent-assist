import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Row = {
  caseId: string;
  memberId: string;
  requestedMedication: string;
  status?: string;
  determination?: string | null;
};

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const url = new URL(request.url);
  const memberId = url.searchParams.get("memberId");
  const drug = url.searchParams.get("drug");
  const rows = readFixture<Row[]>("coverage.json");
  let match = rows;
  if (memberId) match = match.filter((r) => r.memberId === memberId);
  if (drug) {
    match = match.filter((r) =>
      r.requestedMedication.toLowerCase().includes(drug.toLowerCase()),
    );
  }
  return NextResponse.json(envelope("coverage-review", { cases: match }));
}
