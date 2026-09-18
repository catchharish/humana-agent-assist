import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET() {
  const rules = readFixture<Record<string, unknown>>("utterance_rules.json");
  return NextResponse.json(envelope("scripting", { rules }));
}
