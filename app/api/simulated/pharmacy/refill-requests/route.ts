import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const memberId = new URL(request.url).searchParams.get("memberId");
  const row = readFixture<{ requestId: string; memberId: string; drugName?: string }>(
    "refill.json",
  );
  if (memberId && row.memberId !== memberId) {
    return NextResponse.json(envelope("pharmacy", { requests: [] }));
  }
  return NextResponse.json(envelope("pharmacy", { requests: [row] }));
}
