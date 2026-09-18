import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Policy = {
  policyId: string;
  planId: string;
  body: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  await applyDemoHeaders(request);
  const { planId } = await context.params;
  const policies = readFixture<Policy[]>("policies.json");
  const policy = policies.find((p) => p.planId === planId);
  if (!policy) {
    return NextResponse.json(envelope("benefits", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("benefits", policy));
}
