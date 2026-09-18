import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CLARIFY_INTEREST } from "@/lib/copy";
import { createSession } from "@/lib/session";
import {
  classifyComparisonConsent,
  quoteAmountsMayRender,
  type UtteranceRules,
} from "@/lib/utteranceRules";
import { finalCompatibleWithPartial } from "@/lib/interpret";
import { applyGovernedUtteranceRules } from "@/lib/copilot";
import type { DisclosureRequirement } from "@/lib/types";

const rules = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "fixtures/utterance_rules.json"),
    "utf8",
  ),
) as UtteranceRules;

const STREAM_LINES = new Set([
  "Yeah, I guess, sure",
  "Yes, please compare both.",
  "Yes, please compare both",
]);

function sessionWithRules() {
  return createSession({
    disclosures: [] as DisclosureRequirement[],
    disclosureFetch: "test",
    utteranceRules: rules,
  });
}

const scoped =
  "To confirm: would you like to hear the retail and delivery estimates for both of your existing medicines? Hearing those estimates does not enroll you in anything.";

describe("conservative comparison consent (governed patterns)", () => {
  function decide(
    text: string,
    extra: { stability?: string; lastAdvocate?: string; scoped?: boolean } = {},
  ) {
    return classifyComparisonConsent({
      rules,
      speaker: "member",
      text,
      stability: extra.stability ?? "final",
      optionalWorkSuppressed: false,
      scopedPending: extra.scoped ?? true,
      lastAdvocate: extra.lastAdvocate ?? scoped,
    });
  }

  it("rejects hedges and partial/compound yes; accepts scoped compare", () => {
    const cases: Array<{
      text: string;
      stability?: string;
      lastAdvocate?: string;
      scoped?: boolean;
      expect: string;
    }> = [
      { text: "Yeah, I guess, sure", expect: "hedge" },
      { text: "I guess so", expect: "hedge" },
      { text: "sure, whatever", expect: "hedge" },
      { text: "yes", stability: "partial", expect: "wait" },
      {
        text: "Yes, please compare both",
        lastAdvocate: "Do you want prices and to enroll now?",
        scoped: false,
        expect: "hedge",
      },
      { text: "Yes, please compare both", expect: "absolute_yes" },
      { text: "Sure, compare them", expect: "absolute_yes" },
    ];
    for (const c of cases) {
      expect(decide(c.text, c), c.text).toBe(c.expect);
    }
  });

  it("accepts six new unambiguous affirmatives not from streams", () => {
    const fires = [
      "Yes please.",
      "Yes, go ahead.",
      "Please do.",
      "I'd like that.",
      "Go ahead.",
      "Absolutely.",
    ];
    expect(fires).toHaveLength(6);
    for (const text of fires) {
      expect(STREAM_LINES.has(text), text).toBe(false);
      expect(decide(text), text).toBe("absolute_yes");
    }
  });

  it("rejects six new hedges not from streams", () => {
    const hedges = [
      "If you think so",
      "Maybe later",
      "Kind of",
      "I suppose so",
      "Whatever you recommend",
      "Sort of, yeah",
    ];
    expect(hedges).toHaveLength(6);
    for (const text of hedges) {
      expect(STREAM_LINES.has(text), text).toBe(false);
      expect(decide(text), text).toBe("hedge");
    }
  });

  it("hedges and compound yes show clarification; partials do not", async () => {
    const blocked = [
      { text: "Yeah, I guess, sure", stability: "final" as const },
      { text: "I guess so", stability: "final" as const },
      { text: "sure, whatever", stability: "final" as const },
    ];
    for (const c of blocked) {
      const session = sessionWithRules();
      session.identityStatus = "VALID";
      session.transcript = [
        {
          id: "adv",
          speaker: "advocate",
          stability: "final",
          text: scoped,
          receivedAt: Date.now(),
        },
      ];
      await applyGovernedUtteranceRules(session, "http://127.0.0.1:9", {
        speaker: "member",
        stability: c.stability,
        text: c.text,
      });
      expect(quoteAmountsMayRender(session.consent.comparison), c.text).toBe(
        false,
      );
      expect(session.quotes, c.text).toEqual([]);
      expect(session.consent.comparison, c.text).toBe("hedge");
      expect(session.nowCard.body, c.text).toBe(CLARIFY_INTEREST);
    }

    const partial = sessionWithRules();
    partial.identityStatus = "VALID";
    partial.nowCard = {
      title: "SENTINEL",
      body: "do not replace on partial",
      sourceLabel: "test",
    };
    partial.transcript = [
      {
        id: "adv",
        speaker: "advocate",
        stability: "final",
        text: scoped,
        receivedAt: Date.now(),
      },
    ];
    await applyGovernedUtteranceRules(partial, "http://127.0.0.1:9", {
      speaker: "member",
      stability: "partial",
      text: "yes",
    });
    expect(partial.consent.comparison).toBe("none");
    expect(partial.nowCard.title).toBe("SENTINEL");
    expect(partial.nowCard.body).toBe("do not replace on partial");
    expect(partial.quotes).toEqual([]);

    const compound = sessionWithRules();
    compound.identityStatus = "VALID";
    compound.transcript = [
      {
        id: "adv",
        speaker: "advocate",
        stability: "final",
        text: "Do you want prices and to enroll now?",
        receivedAt: Date.now(),
      },
    ];
    await applyGovernedUtteranceRules(compound, "http://127.0.0.1:9", {
      speaker: "member",
      stability: "final",
      text: "Yes, please compare both",
    });
    expect(compound.consent.comparison).toBe("hedge");
    expect(compound.nowCard.body).toBe(CLARIFY_INTEREST);
    expect(compound.quotes).toEqual([]);
    expect(quoteAmountsMayRender(compound.consent.comparison)).toBe(false);
  });

  it("scoped absolute yes after the clarification question may release quotes", async () => {
    const seeded = {
      quoteId: "q1",
      drugName: "metformin",
      pharmacyId: "ph1",
      pharmacyName: "Lakeview Pharmacy",
      estimatedMemberCost: { value: "8.00", currency: "USD" },
      daysSupply: 90,
      quantity: 1,
      validityStatus: "valid",
    };
    for (const text of ["Yes, please compare both", "Sure, compare them"]) {
      const session = sessionWithRules();
      session.identityStatus = "VALID";
      session.consent.clarification = CLARIFY_INTEREST;
      session.transcript = [
        {
          id: "adv",
          speaker: "advocate",
          stability: "final",
          text: scoped,
          receivedAt: Date.now(),
        },
      ];
      session.quotes = [{ ...seeded }];
      await applyGovernedUtteranceRules(session, "http://127.0.0.1:9", {
        speaker: "member",
        stability: "final",
        text,
      });
      expect(session.consent.comparison, text).toBe("absolute_yes");
      expect(quoteAmountsMayRender(session.consent.comparison), text).toBe(true);
    }
  });

  it("reuses a partial when the final only adds trailing punctuation", () => {
    expect(
      finalCompatibleWithPartial("yes", "yes."),
    ).toBe(true);
    expect(
      finalCompatibleWithPartial("yes", "yes, I guess"),
    ).toBe(false);
  });

  it("does not render amounts when quotes exist but consent is not absolute yes", () => {
    expect(quoteAmountsMayRender("none")).toBe(false);
    expect(quoteAmountsMayRender("hedge")).toBe(false);
    expect(quoteAmountsMayRender("absolute_yes")).toBe(true);
  });
});
