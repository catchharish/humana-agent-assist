import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function POST(request: Request) {
  await applyDemoHeaders(request);
  const docs = readFixture<
    Array<{
      id: string;
      kind: string;
      planId: string | null;
      audience: string;
      effectiveDate: string;
      text: string;
    }>
  >("knowledge.json");
  const candidates = docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    planId: d.planId,
    audience: d.audience,
    effectiveDate: d.effectiveDate,
    text: d.text,
  }));
  return NextResponse.json(envelope("scripting", { candidates }));
}
