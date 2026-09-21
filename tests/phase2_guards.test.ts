import { describe, expect, it } from "vitest";
import { confirmDisposition } from "@/lib/copilot";
import { createSession, recordActionResult } from "@/lib/session";

function sessionWithOptions() {
  const session = createSession({ disclosures: [], disclosureFetch: "test" });
  session.disposition.options = [
    {
      code: "TRANSFERRED_COVERAGE_REVIEW",
      meaning: "connected transfer",
      safetyRequirement: "confirmed_connection",
    },
    {
      code: "ENROLLED_SERVICE",
      meaning: "confirmed enrollment",
      safetyRequirement: "confirmed_enrollment",
    },
    {
      code: "UNRESOLVED_FOLLOW_UP",
      meaning: "unresolved",
      safetyRequirement: "none",
    },
  ];
  return session;
}

describe("Phase 2 disposition safety guards", () => {
  it("refuses every code before an end-of-call trigger", () => {
    const session = sessionWithOptions();
    expect(confirmDisposition(session, "UNRESOLVED_FOLLOW_UP").ok).toBe(false);
  });

  it("requires a confirmed receiving connection for transferred", () => {
    const session = sessionWithOptions();
    session.callEnd.triggered = true;
    session.transfer.connectionStatus = "pending";
    expect(
      confirmDisposition(session, "TRANSFERRED_COVERAGE_REVIEW").ok,
    ).toBe(false);
    session.transfer.connectionStatus = "failed";
    expect(
      confirmDisposition(session, "TRANSFERRED_COVERAGE_REVIEW").ok,
    ).toBe(false);
    session.transfer.connectionStatus = "receiving_specialist_connected";
    expect(
      confirmDisposition(session, "TRANSFERRED_COVERAGE_REVIEW").ok,
    ).toBe(true);
  });

  it("requires a confirmed scoped enrollment result for enrolled", () => {
    const session = sessionWithOptions();
    session.callEnd.triggered = true;
    session.enrollment.submitted = true;
    session.enrollment.resultId = "DEMO-ENR-X";
    session.enrollment.scopeOk = true;
    expect(confirmDisposition(session, "ENROLLED_SERVICE").ok).toBe(false);
    recordActionResult(session, {
      kind: "enrollment_submit",
      title: "Enrollment result",
      body: "Confirmed scoped enrollment.",
      sourceLabel: "System record · pharmacy · simulated",
      at: new Date().toISOString(),
    });
    expect(confirmDisposition(session, "ENROLLED_SERVICE").ok).toBe(true);
  });
});
