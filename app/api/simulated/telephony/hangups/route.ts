import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { envelope } from "@/app/api/simulated/_data";

export async function POST() {
  return NextResponse.json(
    envelope("telephony", {
      hangupId: `DEMO-HANGUP-${randomUUID()}`,
      status: "CALL_DISCONNECTED",
    }),
  );
}
