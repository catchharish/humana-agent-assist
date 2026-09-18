import { NextResponse } from "next/server";
import { envelope } from "@/app/api/simulated/_data";

export async function GET() {
  return NextResponse.json(
    envelope("telephony", {
      contactId: "DEMO-CONTACT-M1",
      ivrReason: "refill",
    }),
  );
}
