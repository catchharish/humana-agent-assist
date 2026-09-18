import { NextResponse } from "next/server";
import { envelope } from "@/app/api/simulated/_data";
import { consumeEnrollmentToken } from "@/lib/enrollmentToken";
import { saveEnrollment } from "@/lib/enrollmentRecords";

export async function POST(request: Request) {
  const token = request.headers.get("x-enrollment-token") ?? undefined;
  const body = (await request.json().catch(() => ({}))) as {
    memberId?: string;
    medicationScope?: string[];
  };
  const scope = { medications: body.medicationScope ?? [] };
  const check = consumeEnrollmentToken(
    token,
    scope,
    request.headers.get("x-session-id") ?? undefined,
  );
  if (!check.ok) {
    return NextResponse.json(envelope("pharmacy", { error: check.error }), {
      status: check.status,
    });
  }
  const enrollmentId = "DEMO-ENR001";
  const record = {
    enrollmentId,
    memberId: body.memberId ?? "DEMO-M001",
    serviceType: "centerwell_pharmacy_service",
    medicationScope: scope.medications,
    status: "active",
  };
  saveEnrollment(enrollmentId, record);
  return NextResponse.json(envelope("pharmacy", record));
}
