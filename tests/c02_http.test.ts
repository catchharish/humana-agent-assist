import { describe, expect, it } from "vitest";
import { originUp } from "./driver";

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
});
