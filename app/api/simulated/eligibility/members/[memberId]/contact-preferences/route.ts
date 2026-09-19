import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

type Pref = {
  memberId: string;
  doNotContact: boolean;
  mailServiceEnrolled: boolean;
  notes?: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await context.params;
  const rows = readFixture<Pref[]>("contact_preferences.json");
  const row = rows.find((r) => r.memberId === memberId);
  if (!row) {
    return NextResponse.json(
      envelope("eligibility", { error: "not_found" }),
      { status: 404 },
    );
  }
  return NextResponse.json(envelope("eligibility", row));
}
