import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Row = {
  requestId: string;
  memberId: string;
  drugName?: string;
};

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const memberId = new URL(request.url).searchParams.get("memberId");
  const rows = readFixture<Row[]>("refill.json");
  const requests = memberId ? rows.filter((r) => r.memberId === memberId) : rows;
  return NextResponse.json(envelope("pharmacy", { requests }));
}
