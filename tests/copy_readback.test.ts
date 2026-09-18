import { describe, expect, it } from "vitest";
import {
  enrollmentReadback,
  hasDoubledWords,
  offerBody,
  outcomeWith,
  outcomeWithout,
  transferOffer,
  CLARIFY_INTEREST,
  OBJECTION_BODY,
} from "@/lib/copy";
import { mintEnrollmentToken, consumeEnrollmentToken } from "@/lib/enrollmentToken";

function memberFacingSamples() {
  const single = enrollmentReadback({
    serviceName: "the CenterWell pharmacy service",
    deliveryMedications: ["metformin"],
    retailMedications: ["atorvastatin"],
    pickupPharmacy: "Lakeview Pharmacy",
  });
  const dual = enrollmentReadback({
    serviceName: "the CenterWell pharmacy service",
    deliveryMedications: ["metformin", "atorvastatin"],
    retailMedications: [],
    pickupPharmacy: "Lakeview Pharmacy",
  });
  return {
    single,
    dual,
    other: [
      offerBody({ mailPharmacy: "CenterWell Pharmacy" }),
      outcomeWithout({ historicalNeed: "historical-charge" }),
      outcomeWith({ memberGiven: "Harry" }),
      transferOffer({ caseId: "DEMO-CVR001", requestedMedication: "Jardiance" }),
      CLARIFY_INTEREST,
      OBJECTION_BODY,
    ],
  };
}

describe("parameterized enrollment readback", () => {
  const { single, dual, other } = memberFacingSamples();

  it("single-scope names delivery vs retail", () => {
    console.log("enrollment_readback_single", single);
    expect(single).toContain("the CenterWell pharmacy service");
    expect(single).toMatch(/future metformin fills/);
    expect(single).toMatch(/Atorvastatin stays at retail/);
    expect(single).toMatch(/Today's ready refill stays at Lakeview Pharmacy/);
    expect(single).not.toMatch(/the the/i);
    expect(single).not.toMatch(/pharmacy pharmacy/i);
  });

  it("dual-scope names both medications", () => {
    console.log("enrollment_readback_dual", dual);
    expect(dual).toMatch(/metformin and atorvastatin/);
    expect(dual).toContain("the CenterWell pharmacy service");
    expect(dual).not.toMatch(/the the/i);
  });

  it("does not consume a token for a different confirmed scope", () => {
    const token = mintEnrollmentToken("sess-both", {
      medications: ["metformin", "atorvastatin"],
    });
    const wrong = consumeEnrollmentToken(token, { medications: ["metformin"] });
    expect(wrong.ok).toBe(false);
  });

  it("fails on doubled words in any generated or templated member-facing sentence", () => {
    expect(hasDoubledWords("enroll in the the mail pharmacy")).toBe(true);
    expect(hasDoubledWords("pharmacy pharmacy service")).toBe(true);
    for (const s of [single, dual, ...other]) {
      expect(hasDoubledWords(s), s).toBe(false);
    }
  });
});
