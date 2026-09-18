import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(request: Request) {
  await applyDemoHeaders(request);
  const claims = readFixture<unknown[]>("purchases.json");
  return NextResponse.json(envelope("claims", { claims }));
}
