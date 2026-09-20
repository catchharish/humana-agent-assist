import { afterEach, describe, expect, it } from "vitest";
import {
  HONEST_MISS_BODY,
  runAnswerLoop,
  setForcedOpenAi,
} from "@/lib/answerLoop";
import { createSession } from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

describe("honest model failure", () => {
  afterEach(() => setForcedOpenAi(null));

  it("does not show member facts as the answer when the model fails", async () => {
    setForcedOpenAi([
      {
        status: 500,
        json: { error: { message: "forced", type: "server_error" } },
      },
      {
        status: 500,
        json: { error: { message: "forced", type: "server_error" } },
      },
    ]);
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    session.member = {
      memberId: "DEMO-M001",
      name: { given: "Test", family: "Member" },
      planId: "DEMO-MAPD-001",
      lineOfBusiness: "MAPD",
    };
    session.prefetch = {
      refill: null,
      refillFresh: null,
      claims: [
        {
          claimId: "DEMO-C0818",
          memberPaidAmount: { value: "8.00" },
          pharmacy: { name: "Oak Street Pharmacy" },
        },
      ],
      classifications: [],
      fast90: null,
      serviceGuide: null,
      objection: null,
      prescriptions: [],
      contactPreferences: { doNotContact: false, mailServiceEnrolled: false },
    };
    const result = await runAnswerLoop({
      origin: "http://127.0.0.1:9",
      memberId: "DEMO-M001",
      planId: "DEMO-MAPD-001",
      authId: "DEMO-AUTH001",
      question: "Why was my last fill more than I expected?",
      loadedSnapshot: false,
      shortAnswers: true,
      nbaParallel: false,
      clockStart: performance.now(),
      generation: 0,
      session,
      identityVerified: true,
      dueNow: false,
      preload: false,
      preloadSearchOnly: false,
      paintNow: true,
    });
    expect(result.answer).toBe(HONEST_MISS_BODY);
    expect(result.answer).not.toMatch(/8\.00|Oak Street|metformin/i);
    expect(session.nowCard.body).toBe(HONEST_MISS_BODY);
    expect(session.nowCard.body).not.toMatch(/8\.00|Oak Street/i);
    expect(session.nowCard.canRetry).toBe(true);
    expect(session.nowCard.statements ?? []).toEqual([]);
  });
});
