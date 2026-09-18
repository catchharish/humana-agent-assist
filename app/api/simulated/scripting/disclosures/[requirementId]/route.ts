import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Req = { requirementId: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ requirementId: string }> },
) {
  await applyDemoHeaders(request);
  const { requirementId } = await context.params;
  const fixture = readFixture<{ requirements: Req[] }>("disclosures.json");
  const row = fixture.requirements.find((r) => r.requirementId === requirementId);
  if (!row) {
    return NextResponse.json(envelope("scripting", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("scripting", row));
}
