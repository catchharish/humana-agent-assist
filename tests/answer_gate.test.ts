import { afterEach, describe, expect, it } from "vitest";
import { statementsFromModel } from "@/lib/citations";
import {
  beginAnswerLoop,
  createSession,
  shouldApplyAnswerLoop,
} from "@/lib/session";
import { runAnswerLoop, setForcedOpenAi } from "@/lib/answerLoop";
import type { DisclosureRequirement } from "@/lib/types";

function terraText(text: string) {
  return {
    status: 200,
    json: { output_text: text },
  };
}

describe("line-need gate", () => {
  afterEach(() => setForcedOpenAi(null));

  it("parses a nothing-needed envelope without statements", () => {
    const parsed = statementsFromModel(
      '{"need":"nothing","reason":"acknowledgement of the enrollment readback"}',
    );
    expect(parsed.need).toBe("nothing");
    expect(parsed.prose).toBe("");
    expect(parsed.statements).toEqual([]);
  });

  it("caps advocate say at three sentences", () => {
    const parsed = statementsFromModel(
      JSON.stringify({
        need: "answer",
        headline: "The refill is ready",
        say: "The atorvastatin is ready at Lakeview. He has not picked it up. Today’s pickup does not change. A fourth sentence should not appear.",
        statements: [
          { text: "Ready at Lakeview.", sourceId: "DEMO-RF001" },
        ],
      }),
    );
    expect(parsed.prose.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
    expect(parsed.prose).not.toMatch(/fourth sentence/i);
  });

  it.each([
    "Yes, for metformin only",
    "okay thanks",
    "sure, put me through",
    "nice weather today",
  ])("creates no item and no answer for %s", async (line) => {
    setForcedOpenAi([
      terraText(
        JSON.stringify({
          need: "nothing",
          reason: "not a question or request",
        }),
      ),
    ]);
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    session.nowCard = {
      title: "Read this back",
      body: "You want CenterWell for metformin.",
      sourceLabel: "This call",
    };
    const result = await runAnswerLoop({
      origin: "http://127.0.0.1:9",
      memberId: "DEMO-M001",
      planId: "DEMO-MAPD-001",
      authId: "DEMO-AUTH001",
      question: line,
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
      sourceUtteranceId: "u1",
      provisionalNeed: true,
    });
    expect(result.answer).toBe("no new answer");
    expect(session.needs).toEqual([]);
    expect(session.nowCard.body).toBe("You want CenterWell for metformin.");
    expect(session.nowCard.title).toBe("Read this back");
  });

  it("still answers a real question after a nothing-needed line", async () => {
    setForcedOpenAi([
      terraText(
        JSON.stringify({
          need: "nothing",
          reason: "acknowledgement",
        }),
      ),
      terraText(
        JSON.stringify({
          need: "answer",
          rightNow: "Harry is asking if the refill is ready",
          headline: "The refill is ready",
          say: "Tell him the atorvastatin is ready at Lakeview. He has not picked it up yet.",
          statements: [
            {
              text: "Atorvastatin is ready at Lakeview.",
              sourceId: "snap",
            },
          ],
        }),
      ),
    ]);
    const session = createSession({
      disclosures: [] as DisclosureRequirement[],
      disclosureFetch: "test",
    });
    session.identityStatus = "VALID";
    await runAnswerLoop({
      origin: "http://127.0.0.1:9",
      memberId: "DEMO-M001",
      planId: "DEMO-MAPD-001",
      authId: "DEMO-AUTH001",
      question: "okay thanks",
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
      provisionalNeed: true,
    });
    const g = beginAnswerLoop(session, "is my refill ready", "refill_status");
    expect(shouldApplyAnswerLoop(session, g)).toBe(true);
    session.needs = [
      {
        kind: "refill_status",
        status: "active",
        guidance: "preparing",
        flowStep: "check",
        queryText: "is my refill ready",
        sourceUtteranceId: "q2",
      },
    ];
    const result = await runAnswerLoop({
      origin: "http://127.0.0.1:9",
      memberId: "DEMO-M001",
      planId: "DEMO-MAPD-001",
      authId: "DEMO-AUTH001",
      question: "is my refill ready",
      loadedSnapshot: false,
      shortAnswers: true,
      nbaParallel: false,
      clockStart: performance.now(),
      generation: g,
      session,
      identityVerified: true,
      dueNow: false,
      preload: false,
      preloadSearchOnly: false,
      paintNow: true,
      needKind: "refill_status",
      sourceUtteranceId: "q2",
    });
    expect(result.answer).not.toBe("no new answer");
    const refill = session.needs.find((n) => n.kind === "refill_status");
    expect(refill?.answer?.body || session.nowCard.body).toBeTruthy();
    expect(refill?.status === "resolved" || refill?.status === "unresolved_gap").toBe(
      true,
    );
  });
});
