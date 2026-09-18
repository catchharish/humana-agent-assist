import { describe, expect, it } from "vitest";
import { originUp } from "./driver";
import { mintEnrollmentToken } from "@/lib/enrollmentToken";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const live = await originUp();

describe.skipIf(!live)("C02 HTTP enrollment boundary", () => {
  it("AI-layer POST without token is 403", async () => {
    const resp = await fetch(`${ORIGIN}/api/simulated/pharmacy/enrollments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: "DEMO-M001",
        medicationScope: ["metformin"],
      }),
    });
    expect(resp.status).toBe(403);
  });

  it("C02 overlay GET is not a success for metformin-only", async () => {
    const mint = mintEnrollmentToken("c02-live", { medications: ["metformin"] });
    const post = await fetch(`${ORIGIN}/api/simulated/pharmacy/enrollments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-enrollment-token": mint,
        "x-session-id": "c02-live",
      },
      body: JSON.stringify({
        memberId: "DEMO-M001",
        medicationScope: ["metformin"],
      }),
    });
    expect(post.status).toBe(200);
    const json = (await post.json()) as { data?: { enrollmentId?: string } };
    const id = json.data?.enrollmentId;
    expect(id).toBeTruthy();
    const got = await fetch(
      `${ORIGIN}/api/simulated/pharmacy/enrollments/${id}`,
      { headers: { "x-demo-overlay": "C02" } },
    );
    const body = (await got.json()) as {
      data?: { medicationScope?: string[] };
    };
    expect(body.data?.medicationScope).toEqual(["metformin", "atorvastatin"]);
  });
});
