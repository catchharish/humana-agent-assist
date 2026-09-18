import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET() {
  const fixture = readFixture<{
    policyLabel: string;
    requirements: unknown[];
  }>("disclosures.json");
  return NextResponse.json(
    envelope("scripting", {
      policyLabel: fixture.policyLabel,
      requirements: fixture.requirements,
    }),
  );
}
