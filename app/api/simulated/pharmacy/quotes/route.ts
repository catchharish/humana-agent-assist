import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Quote = { quoteId: string; pharmacyId: string; memberId?: string };

export async function GET(request: Request) {
  const { overlay } = await applyDemoHeaders(request);
  const url = new URL(request.url);
  const pharmacyId = url.searchParams.get("pharmacyId");
  const memberId = url.searchParams.get("memberId");
  if (overlay === "T04B" && pharmacyId === "lakeview") {
    await new Promise((r) => setTimeout(r, 2000));
  }
  let quotes = readFixture<Quote[]>("quotes.json");
  if (memberId) {
    quotes = quotes.filter((q) => !q.memberId || q.memberId === memberId);
  }
  if (pharmacyId) {
    quotes = quotes.filter((q) => q.pharmacyId === pharmacyId);
  }
  return NextResponse.json(envelope("pharmacy", { quotes }));
}
