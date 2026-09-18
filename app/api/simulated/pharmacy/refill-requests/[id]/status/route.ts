import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await applyDemoHeaders(request);
  const { id } = await context.params;
  const row = readFixture<{ requestId: string }>("refill.json");
  if (row.requestId !== id) {
    return NextResponse.json(envelope("pharmacy", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(
    envelope("pharmacy", { ...row, fillStatus: "ready_for_pickup" }),
  );
}
