import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const memberId = new URL(request.url).searchParams.get("memberId");
  const rows = readFixture<Array<{ memberId: string }>>("prescriptions.json");
  return NextResponse.json(
    envelope("pharmacy", {
      prescriptions: memberId ? rows.filter((r) => r.memberId === memberId) : rows,
    }),
  );
}
