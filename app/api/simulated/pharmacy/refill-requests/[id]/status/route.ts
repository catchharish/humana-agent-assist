import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Row = { requestId: string; fillStatus?: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await applyDemoHeaders(request);
  const { id } = await context.params;
  const rows = readFixture<Row[]>("refill.json");
  const row = rows.find((r) => r.requestId === id);
  if (!row) {
    return NextResponse.json(envelope("pharmacy", { error: "not_found" }), {
      status: 404,
    });
  }
  const fillStatus =
    row.requestId === "DEMO-RF001" ? "ready_for_pickup" : row.fillStatus;
  return NextResponse.json(envelope("pharmacy", { ...row, fillStatus }));
}
