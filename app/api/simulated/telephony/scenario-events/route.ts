import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

type StreamFixture = {
  scenarioId: string;
  callDate: string;
  events: unknown[];
};

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "t01_m2a";
  const allowed = new Set([
    "t01_m1",
    "t01_m2a",
    "t02a",
    "t03a",
    "t03b",
    "t04b",
    "t06a",
    "t08b",
    "open_call",
  ]);
  if (!allowed.has(id)) {
    return NextResponse.json(
      envelope("telephony", { error: "unknown_scenario" }),
      { status: 404 },
    );
  }
  const fixture = readFixture<StreamFixture>(`streams/${id}.json`);
  return NextResponse.json(envelope("telephony", fixture));
}
