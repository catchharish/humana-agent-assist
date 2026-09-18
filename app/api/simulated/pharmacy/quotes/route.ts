import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Quote = { quoteId: string; pharmacyId: string };

export async function GET(request: Request) {
  const { overlay } = await applyDemoHeaders(request);
  const pharmacyId = new URL(request.url).searchParams.get("pharmacyId");
  if (overlay === "T04B" && pharmacyId === "lakeview") {
    await new Promise((r) => setTimeout(r, 2000));
  }
  let quotes = readFixture<Quote[]>("quotes.json");
  if (pharmacyId) {
    quotes = quotes.filter((q) => q.pharmacyId === pharmacyId);
  }
  return NextResponse.json(envelope("pharmacy", { quotes }));
}
