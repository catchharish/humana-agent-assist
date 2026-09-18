import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Pharmacy = { pharmacyId: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ pharmacyId: string }> },
) {
  await applyDemoHeaders(request);
  const { pharmacyId } = await context.params;
  const rows = readFixture<Pharmacy[]>("pharmacies.json");
  const row = rows.find((p) => p.pharmacyId === pharmacyId);
  if (!row) {
    return NextResponse.json(envelope("provider", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("provider", row));
}
