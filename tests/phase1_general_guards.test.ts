import { describe, expect, it } from "vitest";
import {
  containsLockedQuoteContent,
  removeLockedQuoteContent,
} from "@/lib/answerLoop";
import { recordFactsFromSources } from "@/lib/citations";
import { createSession, sessions } from "@/lib/session";

describe("Phase 1 general guards", () => {
  it("recognizes pre-consent future quote content without keying to a question", () => {
    expect(
      containsLockedQuoteContent(
        "Prospective amounts are available after comparison consent.",
      ),
    ).toBe(true);
    expect(
      containsLockedQuoteContent(
        "The recorded option supports eligible existing prescriptions.",
      ),
    ).toBe(false);
    expect(
      containsLockedQuoteContent("The completed claim was $8.00."),
    ).toBe(false);
  });

  it("removes only the locked sentence from a mixed model statement", () => {
    const filtered = removeLockedQuoteContent([
      {
        text: "The completed claim was $8.00. Prospective amounts are available after comparison consent. The current prescription remains active.",
        sourceId: "record-1",
      },
    ]);
    expect(filtered).toEqual([
      {
        text: "The completed claim was $8.00. The current prescription remains active.",
        sourceId: "record-1",
      },
    ]);
  });

  it("turns a status record with a subject and reference into an early fact", () => {
    const facts = recordFactsFromSources([
      {
        id: "case-1",
        kind: "record",
        sourceTag: "Coverage review",
        text: JSON.stringify({
          caseId: "case-1",
          requestedMedication: "Example medicine",
          status: "pending_review",
        }),
      },
    ]);
    expect(facts[0]?.text).toContain("case-1");
    expect(facts[0]?.text).toContain("Example medicine");
    expect(facts[0]?.text).toContain("pending_review");
  });

  it("bounds live in-memory sessions while run logs remain durable", () => {
    sessions.clear();
    for (let i = 0; i < 70; i += 1) {
      createSession({ disclosures: [], disclosureFetch: "test" });
    }
    expect(sessions.size).toBe(64);
    sessions.clear();
  });
});
