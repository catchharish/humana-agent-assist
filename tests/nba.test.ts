import { describe, expect, it } from "vitest";
import { createSession } from "@/lib/session";
import { applyNbaAfterAnswer, nbaHardStop } from "@/lib/nba";
import type { DisclosureRequirement } from "@/lib/types";

function sessionWithPrefs(over: {
  identity?: string;
  pricing?: "not_applicable" | "due_now";
  enrolled?: boolean;
  dnc?: boolean;
  saidNo?: boolean;
  dismissed?: boolean;
}) {
  const s = createSession({
    disclosures: [] as DisclosureRequirement[],
    disclosureFetch: "test",
  });
  s.identityStatus = over.identity ?? "VALID";
  if (over.pricing === "due_now") {
    s.pricing = "due_now";
    s.pricingExactDelivered = false;
  }
  s.prefetch = {
    refill: null,
    refillFresh: null,
    claims: [],
    classifications: [],
    fast90: null,
    serviceGuide: null,
    objection: null,
    prescriptions: [],
    contactPreferences: {
      doNotContact: Boolean(over.dnc),
      mailServiceEnrolled: Boolean(over.enrolled),
    },
  };
  if (over.saidNo) s.optionalWorkSuppressed = true;
  if (over.dismissed) s.nbaDismissedThisCall = true;
  return s;
}

describe("NBA hard stops", () => {
  it("blocks unverified identity", () => {
    const s = sessionWithPrefs({ identity: "unverified" });
    expect(nbaHardStop(s).stop).toBe("unverified");
  });
  it("blocks due-now required wording", () => {
    const s = sessionWithPrefs({ pricing: "due_now" });
    expect(nbaHardStop(s).stop).toBe("due_now");
  });
  it("blocks already enrolled", () => {
    const s = sessionWithPrefs({ enrolled: true });
    expect(nbaHardStop(s).stop).toBe("already_enrolled");
  });
  it("blocks do-not-contact", () => {
    const s = sessionWithPrefs({ dnc: true });
    expect(nbaHardStop(s).stop).toBe("do_not_contact");
  });
  it("blocks said no this call", () => {
    const s = sessionWithPrefs({ saidNo: true });
    expect(nbaHardStop(s).stop).toBe("said_no");
  });
  it("blocks dismissed this call", () => {
    const s = sessionWithPrefs({ dismissed: true });
    expect(nbaHardStop(s).stop).toBe("dismissed_this_call");
  });
  it("does not show a model proposal when a hard stop hits", () => {
    const s = sessionWithPrefs({ enrolled: true });
    applyNbaAfterAnswer(s, {
      action: "optional_comparison",
      title: "Compare",
      body: "Offer retail vs mail",
      reasons: ["cost question"],
      facts: ["not enrolled — false"],
      playbookIds: [],
      considered: [],
      preferredVsMail: "",
      advocateControl: "offer_dismiss",
      marksPricingUpcoming: false,
    });
    expect(s.recommendation).toBeNull();
    expect(s.diagnostics.nba.some((r) => r.stop === "already_enrolled")).toBe(
      true,
    );
  });
  it("shows at most one pending suggestion when no hard stop", () => {
    const s = sessionWithPrefs({});
    applyNbaAfterAnswer(s, {
      action: "optional_comparison",
      title: "Compare",
      body: "Offer a retail vs delivery comparison.",
      reasons: ["not enrolled"],
      facts: ["active MAPD"],
      playbookIds: ["DEMO-PLAYBOOK-OFFERS-v1"],
      considered: [],
      preferredVsMail: "",
      advocateControl: "offer_dismiss",
      marksPricingUpcoming: true,
    });
    expect(s.recommendation?.kind).toBe("optional_comparison");
    expect(s.recommendation?.reasons).toContain("not enrolled");
  });
});
