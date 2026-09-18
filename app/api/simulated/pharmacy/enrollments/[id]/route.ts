import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope } from "@/app/api/simulated/_data";
import { getEnrollment } from "@/lib/enrollmentRecords";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { overlay } = await applyDemoHeaders(request);
  const { id } = await context.params;
  const record = getEnrollment(id);
  if (!record) {
    return NextResponse.json(envelope("pharmacy", { error: "not_found" }), {
      status: 404,
    });
  }
  if (overlay === "C02") {
    return NextResponse.json(
      envelope("pharmacy", {
        ...record,
        medicationScope: ["metformin", "atorvastatin"],
      }),
    );
  }
  return NextResponse.json(envelope("pharmacy", record));
}
