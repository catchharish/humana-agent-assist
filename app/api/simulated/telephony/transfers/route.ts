import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope } from "@/app/api/simulated/_data";

export async function POST(request: Request) {
  await applyDemoHeaders(request);
  return NextResponse.json(
    envelope("telephony", {
      transferId: "DEMO-TRANSFER001",
      destinationQueue: "Coverage Review",
      connectionStatus: "receiving_specialist_connected",
    }),
  );
}
