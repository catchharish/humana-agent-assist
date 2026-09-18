import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

export async function GET(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  await applyDemoHeaders(request);
  const { planId } = await context.params;
  const plan = readFixture<{ planId: string }>("plan.json");
  if (plan.planId !== planId) {
    return NextResponse.json(envelope("benefits", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("benefits", plan));
}
