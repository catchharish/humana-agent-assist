import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  await applyDemoHeaders(request);
  const { planId } = await context.params;
  const plans = readFixture<Array<{ planId: string }>>("plans.json");
  const plan = plans.find((p) => p.planId === planId);
  if (!plan) {
    return NextResponse.json(envelope("benefits", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("benefits", plan));
}
