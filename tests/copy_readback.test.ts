import { describe, expect, it } from "vitest";
import { enrollmentReadback } from "@/lib/copy";
import { mintEnrollmentToken, consumeEnrollmentToken } from "@/lib/enrollmentToken";

describe("parameterized enrollment readback", () => {
  const both = enrollmentReadback({
    mailPharmacy: "CenterWell Pharmacy",
    deliveryMedications: ["metformin", "atorvastatin"],
    retailMedications: [],
    pickupPharmacy: "Lakeview Pharmacy",
  });

  it("names both medications when the driver selects both", () => {
    expect(both).toMatch(/metformin/i);
    expect(both).toMatch(/atorvastatin/i);
    expect(both).not.toMatch(/fills only\./);
  });

  it("does not consume a token for a different confirmed scope", () => {
    const token = mintEnrollmentToken("sess-both", {
      medications: ["metformin", "atorvastatin"],
    });
    const wrong = consumeEnrollmentToken(token, { medications: ["metformin"] });
    expect(wrong.ok).toBe(false);
  });
});
