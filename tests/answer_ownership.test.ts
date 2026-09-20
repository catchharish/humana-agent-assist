import { describe, expect, it } from "vitest";
import {
  beginAnswerLoop,
  createSession,
  recordActionResult,
  recordNeedAnswer,
  upsertNeed,
} from "@/lib/session";
import type { DisclosureRequirement } from "@/lib/types";

const disclosures = [] as DisclosureRequirement[];

describe("answers stay with the utterance that produced them", () => {
  it("files a late first answer on its own need after a second question started", () => {
    const s = createSession({ disclosures, disclosureFetch: "test" });
    upsertNeed(s, "historical_price", {
      status: "active",
      queryText: "why the last two fills",
      sourceUtteranceId: "e-q1",
    });
    beginAnswerLoop(s, "why the last two fills", "historical_price", "e-q1");
    s.nowCard = {
      title: "Answer",
      body: "first question answer",
      sourceLabel: "Claims",
    };
    s.nowCardNeedKind = "historical_price";
    s.nowCardOrigin = "answer";
    upsertNeed(s, "refill_status", {
      status: "active",
      queryText: "is a refill ready",
      sourceUtteranceId: "e-q2",
    });
    beginAnswerLoop(s, "is a refill ready", "refill_status", "e-q2");
    recordNeedAnswer(
      s,
      "refill_status",
      {
        title: "Answer",
        body: "second question answer",
        sourceLabel: "Pharmacy system",
      },
      { sourceUtteranceId: "e-q2" },
    );
    expect(s.needs.find((n) => n.kind === "historical_price")?.answer?.body).toBe(
      "first question answer",
    );
    expect(s.needs.find((n) => n.kind === "refill_status")?.answer?.body).toBe(
      "second question answer",
    );
  });

  it("keeps a question answer through an enrollment action and does not file the action as that answer", () => {
    const s = createSession({ disclosures, disclosureFetch: "test" });
    upsertNeed(s, "historical_price", {
      status: "resolved",
      queryText: "why the last two fills",
      sourceUtteranceId: "e-q1",
    });
    recordNeedAnswer(s, "historical_price", {
      title: "Answer",
      body: "first question answer",
      sourceLabel: "Claims",
    });
    s.nowCard = {
      title: "Enrollment result",
      body: "Enrollment is active for the scoped medicines.",
      sourceLabel: "System record · pharmacy · simulated",
    };
    recordActionResult(s, {
      kind: "enrollment_submit",
      title: "Enrollment result",
      body: "Enrollment is active for the scoped medicines.",
      sourceLabel: "System record · pharmacy · simulated",
      at: new Date().toISOString(),
    });
    beginAnswerLoop(s, "what is the case status", "coverage_status", "e-q3");
    expect(s.needs.find((n) => n.kind === "historical_price")?.answer?.body).toBe(
      "first question answer",
    );
    expect(s.actionResults.some((a) => a.kind === "enrollment_submit")).toBe(
      true,
    );
    expect(
      s.needs.find((n) => n.kind === "historical_price")?.answer?.body,
    ).not.toMatch(/Enrollment is active/i);
  });

  it("keeps prior answers in history when the same need is answered again", () => {
    const s = createSession({ disclosures, disclosureFetch: "test" });
    upsertNeed(s, "historical_price", {
      status: "deferred",
      queryText: "why the last two fills",
      sourceUtteranceId: "e-q1",
    });
    recordNeedAnswer(s, "historical_price", {
      title: "Answer",
      body: "waiting answer",
      sourceLabel: "Claims",
    });
    recordNeedAnswer(s, "historical_price", {
      title: "Answer",
      body: "rechecked answer",
      sourceLabel: "Claims",
    });
    const hist = s.needs.find((n) => n.kind === "historical_price");
    expect(hist?.answer?.body).toBe("rechecked answer");
    expect(hist?.answerHistory?.some((a) => a.body === "waiting answer")).toBe(
      true,
    );
  });
});
