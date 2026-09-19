import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Row = { caseId: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  await applyDemoHeaders(request);
  const { caseId } = await context.params;
  const rows = readFixture<Row[]>("coverage.json");
  const row = rows.find((r) => r.caseId === caseId);
  if (!row) {
    return NextResponse.json(
      envelope("coverage-review", { error: "not_found" }),
      { status: 404 },
    );
  }
  return NextResponse.json(envelope("coverage-review", row));
}
