import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  await applyDemoHeaders(request);
  const { caseId } = await context.params;
  const row = readFixture<{ caseId: string }>("coverage.json");
  if (row.caseId !== caseId) {
    return NextResponse.json(
      envelope("coverage-review", { error: "not_found" }),
      { status: 404 },
    );
  }
  return NextResponse.json(envelope("coverage-review", row));
}
