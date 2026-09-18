import { describe, expect, it } from "vitest";
import {
  AI_TOOL_NAMES,
  consumeEnrollmentToken,
  mintEnrollmentToken,
} from "@/lib/enrollmentToken";
import { confirmDisposition } from "@/lib/copilot";
import { createSession } from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

describe("C02 authority / scope", () => {
  it("does not list mint or submit as AI tools", () => {
    expect(AI_TOOL_NAMES).toEqual([
      "retrieve",
      "draft_answer",
      "recommend_nba",
      "recommend_objection",
      "draft_wrap",
    ]);
    expect(AI_TOOL_NAMES.join(" ")).not.toMatch(/mint|submit|enroll/i);
  });

  it("rejects enrollment POST without a token", () => {
    const result = consumeEnrollmentToken(undefined, {
      medications: ["metformin"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects a token whose scope does not match the current request", () => {
    const token = mintEnrollmentToken("sess-c02", { medications: ["metformin"] });
    const result = consumeEnrollmentToken(token, {
      medications: ["metformin", "atorvastatin"],
    });
    expect(result.ok).toBe(false);
  });

  it("does not treat pending transfer as connection or a confirmed coverage transfer", () => {
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.coverage = {
      caseId: "DEMO-CVR001",
      status: "pending_review",
      requestedMedication: "Jardiance 10 mg tablet",
      determination: null,
    };
    session.transfer.destinationConfirmed = true;
    session.transfer.connectionStatus = null;
    confirmDisposition(session, "TRANSFERRED_COVERAGE_REVIEW");
    expect(session.disposition.confirmed).toBeNull();
    expect(session.coverage.status).toBe("pending_review");
    expect(session.coverage.determination).toBeNull();
  });
});
