import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope } from "@/app/api/simulated/_data";

export async function POST(request: Request) {
  const { overlay } = await applyDemoHeaders(request);
  if (overlay === "TELEPHONY_PENDING") {
    return NextResponse.json(
      envelope("telephony", {
        transferId: "DEMO-TRANSFER-PENDING",
        destinationQueue: "Coverage Review",
        connectionStatus: "pending",
      }),
    );
  }
  if (overlay === "TELEPHONY_FAILED") {
    return NextResponse.json(
      envelope("telephony", {
        transferId: "DEMO-TRANSFER-FAILED",
        destinationQueue: "Coverage Review",
        connectionStatus: "failed",
      }),
    );
  }
  return NextResponse.json(
    envelope("telephony", {
      transferId: "DEMO-TRANSFER001",
      destinationQueue: "Coverage Review",
      connectionStatus: "receiving_specialist_connected",
    }),
  );
}
