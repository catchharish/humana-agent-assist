import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Row = {
  classificationId: string;
  planId: string;
  asOfDate: string;
  pharmacyId: string;
  pharmacyName: string;
  networkTier: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  const { overlay } = await applyDemoHeaders(request);
  const { planId } = await context.params;
  const asOf = new URL(request.url).searchParams.get("asOfDate");
  let rows = readFixture<Row[]>("classifications.json").filter(
    (r) => r.planId === planId,
  );
  if (asOf) rows = rows.filter((r) => r.asOfDate === asOf);
  if (overlay === "T06A") {
    rows = rows.filter((r) => r.classificationId !== "DEMO-NET0818");
  }
  return NextResponse.json(envelope("benefits", { rows }));
}
