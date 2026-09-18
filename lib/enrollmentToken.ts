import { randomBytes } from "crypto";

export type EnrollmentScope = {
  medications: string[];
};

type TokenRecord = {
  token: string;
  sessionId: string;
  scope: EnrollmentScope;
  used: boolean;
};

const g = globalThis as unknown as {
  __haaEnrollTokens?: Map<string, TokenRecord>;
};
g.__haaEnrollTokens ??= new Map();
const tokens = g.__haaEnrollTokens;

function normalizeScope(scope: EnrollmentScope): string {
  return JSON.stringify({
    medications: [...scope.medications]
      .map((m) => m.trim().toLowerCase())
      .sort(),
  });
}

/** Presenter Confirm only. Not in the AI tool registry. */
export function mintEnrollmentToken(
  sessionId: string,
  scope: EnrollmentScope,
): string {
  const token = randomBytes(24).toString("hex");
  tokens.set(token, { token, sessionId, scope, used: false });
  return token;
}

export function consumeEnrollmentToken(
  token: string | undefined,
  scope: EnrollmentScope,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!token) {
    return { ok: false, status: 403, error: "missing_enrollment_token" };
  }
  const rec = tokens.get(token);
  if (!rec) {
    return { ok: false, status: 403, error: "unknown_enrollment_token" };
  }
  if (rec.used) {
    return { ok: false, status: 403, error: "enrollment_token_used" };
  }
  if (normalizeScope(rec.scope) !== normalizeScope(scope)) {
    return { ok: false, status: 403, error: "scope_mismatch" };
  }
  rec.used = true;
  return { ok: true };
}

export function invalidateSessionTokens(sessionId: string) {
  for (const [token, rec] of tokens) {
    if (rec.sessionId === sessionId) tokens.delete(token);
  }
}

/** Intentionally no list/read API for AI tools. */
export const AI_TOOL_NAMES = [
  "retrieve",
  "draft_answer",
  "recommend_nba",
  "recommend_objection",
  "draft_wrap",
] as const;
