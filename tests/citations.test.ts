import { describe, expect, it } from "vitest";
import { NO_SUPPORTED_ANSWER, supportCheck } from "@/lib/supportCheck";
import type { RetrievedSource } from "@/lib/citations";

const claims: RetrievedSource = {
  id: "DEMO-C0818",
  kind: "record",
  sourceTag: "Claims",
  text: JSON.stringify({
    claimId: "DEMO-C0818",
    dateOfService: "2026-08-18",
    drugName: "metformin",
    pharmacy: "Oak Street Pharmacy",
    memberPaidAmount: "8.00",
    adjudicationStatus: "PAID",
  }),
};

const claim27: RetrievedSource = {
  id: "DEMO-C0916",
  kind: "record",
  sourceTag: "Claims",
  text: JSON.stringify({
    claimId: "DEMO-C0916",
    dateOfService: "2026-09-16",
    drugName: "metformin",
    pharmacy: "Lakeview Pharmacy",
    memberPaidAmount: "27.00",
    adjudicationStatus: "PAID",
  }),
};

const net0818: RetrievedSource = {
  id: "DEMO-NET0818",
  kind: "classification",
  sourceTag: "Plan rules",
  text: JSON.stringify({
    classificationId: "DEMO-NET0818",
    pharmacyName: "Oak Street Pharmacy",
    asOfDate: "2026-08-18",
    networkTier: "preferred_retail",
  }),
};

const net0916: RetrievedSource = {
  id: "DEMO-NET0916",
  kind: "classification",
  sourceTag: "Plan rules",
  text: JSON.stringify({
    classificationId: "DEMO-NET0916",
    pharmacyName: "Lakeview Pharmacy",
    asOfDate: "2026-09-16",
    networkTier: "standard_retail",
  }),
};

describe("per-statement support check", () => {
  it("keeps every statement of a fully supported answer", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "The 2026-08-18 metformin fill at Oak Street Pharmacy was $8.00.",
          sourceId: "DEMO-C0818",
        },
        {
          text: "The 2026-09-16 metformin fill at Lakeview Pharmacy was $27.00.",
          sourceId: "DEMO-C0916",
        },
      ],
      retrieved: [claims, claim27, net0818, net0916],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818", "DEMO-C0916"],
    });
    expect(r.partial).toBe(false);
    expect(r.statements.filter((s) => s.confirmed)).toHaveLength(2);
    expect(r.body).toMatch(/8\.00/);
    expect(r.body).toMatch(/27\.00/);
  });

  it("drops a statement with an invented amount", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "The 2026-08-18 fill at Oak Street Pharmacy was $8.00.",
          sourceId: "DEMO-C0818",
        },
        {
          text: "The 2026-09-16 fill at Lakeview Pharmacy was $99.00.",
          sourceId: "DEMO-C0916",
        },
      ],
      retrieved: [claims, claim27],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.statements.find((s) => s.text.includes("99.00"))?.confirmed).toBe(
      false,
    );
    expect(r.body).toMatch(/8\.00/);
  });

  it("catches a real source that does not contain the fact", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "The 2026-08-18 fill at Oak Street Pharmacy was $27.00.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.statements[0]?.confirmed).toBe(false);
    expect(r.note).toMatch(/value_not_in_source/);
  });

  it("does not cite an unrelated record for an unsupported-answer limitation", () => {
    const r = supportCheck({
      question: "What happened outside the available records?",
      answer: "",
      statements: [
        {
          text: "I don’t have information about what happened.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.partial).toBe(true);
    expect(r.body).toBe(NO_SUPPORTED_ANSWER);
    expect(r.body).not.toMatch(/retrieved records|source|citation/i);
    expect(r.statements[0]).toMatchObject({
      confirmed: false,
      sourceId: "",
      note: "no_supported_answer",
    });
  });

  it("marks a network-tier cause as not confirmed without a dated classification", () => {
    const r = supportCheck({
      question: "Why was my metformin $8 last month and $27 yesterday?",
      answer: "",
      statements: [
        {
          text: "The 2026-08-18 fill at Oak Street Pharmacy was $8.00.",
          sourceId: "DEMO-C0818",
        },
        {
          text: "Oak Street Pharmacy was preferred retail on 2026-08-18.",
          sourceId: "DEMO-POLICY-COST-v1",
        },
      ],
      retrieved: [
        claims,
        {
          id: "DEMO-POLICY-COST-v1",
          kind: "document",
          sourceTag: "Plan rules",
          text: "matched 30-day metformin is $8 preferred retail and $27 standard retail",
        },
      ],
      toolsUsed: ["getClaims", "getCostShare"],
      snapshotHasPlanRule: true,
      sources: ["DEMO-C0818", "DEMO-POLICY-COST-v1"],
    });
    expect(r.body).toMatch(/cause is not confirmed/i);
    expect(r.body).toMatch(/8\.00/);
    expect(
      r.statements.some((s) => s.note === "network_tier_without_dated_classification"),
    ).toBe(true);
  });

  it("does not replace unrelated confirmed statements with fill charges", () => {
    const r = supportCheck({
      question: "Do I have an open coverage-review case?",
      answer: "",
      statements: [
        {
          text: "The coverage-review request for Ozempic is pending review.",
          sourceId: "DEMO-CVR-OZ",
        },
      ],
      retrieved: [
        claims,
        {
          id: "DEMO-CVR-OZ",
          kind: "record",
          sourceTag: "Coverage review",
          text: JSON.stringify({
            caseId: "DEMO-CVR-OZ",
            requestedMedication: "Ozempic",
            status: "pending review",
          }),
        },
      ],
      toolsUsed: ["getOpenCases", "getCoverageCase"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-CVR-OZ"],
    });
    expect(r.body).toMatch(/Ozempic/i);
    expect(r.body).toMatch(/pending/i);
    expect(r.body).not.toMatch(/The cause is not confirmed/i);
    expect(r.body).not.toMatch(/8\.00/);
  });

  it("treats $8 and 8.00 as the same money", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "The fill was $8 at Oak Street Pharmacy.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.statements[0]?.confirmed).toBe(true);
  });

  it("treats August 18 and 2026-08-18 as the same date", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "The August 18, 2026 fill at Oak Street was $8.00.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.statements[0]?.confirmed).toBe(true);
  });

  it("treats Oak Street and Oak Street Pharmacy as the same name", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "The 2026-08-18 fill at Oak Street was $8.00.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.statements[0]?.confirmed).toBe(true);
  });

  it("does not treat capitalised ordinary words as names to verify", () => {
    const r = supportCheck({
      question: "why",
      answer: "",
      statements: [
        {
          text: "Your September fill at Oak Street Pharmacy was $8.00.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818"],
    });
    expect(r.statements[0]?.confirmed).toBe(true);
    expect(r.statements[0]?.note ?? "").not.toMatch(/Your September/);
  });

  it("keeps prose fill dates like On August 18, 2026 when the record has the ISO date", () => {
    const r = supportCheck({
      question: "Why was my metformin eight dollars last month and twenty-seven dollars yesterday?",
      answer: "",
      statements: [
        {
          text: "On August 18, 2026, you paid $8.00 for a 30-day supply of metformin 500 mg at Oak Street Pharmacy.",
          sourceId: "DEMO-C0818",
        },
        {
          text: "On September 16, 2026, you paid $27.00 for a 30-day supply of metformin 500 mg at Lakeview Pharmacy.",
          sourceId: "DEMO-C0916",
        },
        {
          text: "The cause is not confirmed.",
          sourceId: "DEMO-C0818",
        },
      ],
      retrieved: [claims, claim27],
      toolsUsed: ["getClaims"],
      snapshotHasPlanRule: false,
      sources: ["DEMO-C0818", "DEMO-C0916"],
    });
    expect(r.body).toMatch(/8\.00/);
    expect(r.body).toMatch(/27\.00/);
    expect(r.statements.filter((s) => s.text === "The cause is not confirmed.")[0]?.confirmed).toBe(
      false,
    );
  });
});

describe("advocateFacing", () => {
  it("recasts member-facing paid lines for the advocate", async () => {
    const { advocateFacing } = await import("@/lib/citations");
    expect(
      advocateFacing(
        "On August 18, 2026, you paid $8.00 for metformin at Oak Street Pharmacy.",
        "Harry",
      ),
    ).toBe("On August 18, 2026, Harry paid $8.00 for metformin at Oak Street Pharmacy.");
  });
});
