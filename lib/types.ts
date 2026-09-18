export type TranscriptStability =
  | "partial"
  | "final"
  | "corrected"
  | "uncertain";

export type ObligationStatus =
  | "not_applicable"
  | "pending_later"
  | "due_now"
  | "exact_timely"
  | "paraphrased"
  | "late_finding"
  | "unable_to_verify";

export type DisclosureRequirement = {
  requirementId: string;
  version: string;
  verbatimText: string;
  applicability: string;
  deadlineRule: string;
  repetitionRule: string;
  recoveryRule: string;
  triggerPatterns?: Record<string, unknown>;
};

export type AuthResult = {
  authorizationId: string;
  memberId: string;
  role: string;
  decision: string;
  permittedScopes: string[];
};

export type MemberBrief = {
  memberId: string;
  name: { given: string; family: string };
  planId: string;
  lineOfBusiness: string;
};

export type TranscriptLine = {
  id: string;
  speaker: string;
  stability: TranscriptStability;
  text: string;
  correctsEventId?: string;
  receivedAt: number;
};

export type TimingRecord = {
  eventId: string;
  kind: string;
  tEvent: number;
  tPaint: number | null;
  paintMs: number | null;
  measured: boolean;
  excludedPauseMs: number;
};

export type NeedKind =
  | "refill_status"
  | "historical_price"
  | "prospective_comparison"
  | "service_education"
  | "service_election"
  | "coverage_status";

export type NeedRecord = {
  kind: NeedKind;
  status: "requested" | "active" | "deferred" | "resolved" | "unresolved_gap";
  guidance: "preparing" | "ready" | "deferred_valid" | "invalidated";
  flowStep: string;
  fingerprint?: string;
  queryText?: string;
  sourceUtteranceId?: string;
  answer?: {
    title: string;
    body: string;
    sourceLabel: string;
    causeSupported?: boolean;
    chargesEstablished?: boolean;
  };
};

export type RouterTrace = {
  routesUsed: string[];
  latencyMs: number;
  retrieved: { id: string; sourceSystem: string }[];
  rejected: { id: string; reason: string }[];
  ranked?: { id: string; score: number }[];
  injectedDelayMs?: number;
  recheck?: boolean;
};

export type TriggerTrace = {
  at: string;
  stage: number;
  fired: boolean;
  classification: string;
  latencyMs: number;
  modelCall: boolean;
  reason: string;
  suppressed?: boolean;
};

export type SessionState = {
  sessionId: string;
  startedAt: number;
  elapsedMs: number;
  paused: boolean;
  pauseStartedAt: number | null;
  totalPauseMs: number;
  lastPauseLabel: string | null;
  overlay: string | null;
  scenarioId: string;
  injectedDelayMs: number;
  pricingExactDelivered: boolean;
  prefetch: {
    refill: Record<string, unknown> | null;
    refillFresh: Record<string, unknown> | null;
    claims: unknown[];
    classifications: unknown[];
    fast90: {
      articleId: string;
      body: string;
      lineageSourceId: string | null;
      version?: string;
    } | null;
  } | null;
  callType: string;
  currentNeed: string;
  flowStep: string;
  identityStatus: string;
  auth: AuthResult | null;
  member: MemberBrief | null;
  ivrReason: string | null;
  greeting: ObligationStatus;
  pricing: ObligationStatus;
  closing: ObligationStatus;
  greetingSource: string;
  disclosures: DisclosureRequirement[];
  transcript: TranscriptLine[];
  needs: NeedRecord[];
  nowCard: {
    title: string;
    body: string;
    sourceLabel: string;
    waitingForFocus?: boolean;
  };
  recommendation: {
    kind: "optional_comparison" | "objection_retail" | "warm_transfer";
    title: string;
    body: string;
    sourceLabel: string;
    status: "pending" | "offered" | "dismissed" | "used";
  } | null;
  quotes: Array<{
    quoteId: string;
    drugName: string;
    pharmacyId?: string;
    pharmacyName: string;
    estimatedMemberCost: { value: string; currency: string };
    daysSupply: number;
    quantity: number;
    validityStatus: string;
  }>;
  quoteFocus: { drug: string; pharmacyId: string } | null;
  quoteGeneration: number;
  optionalWorkSuppressed: boolean;
  consent: {
    comparison: "none" | "hedge" | "absolute_yes";
    enrollment: "none" | "hedge" | "absolute_yes";
    clarification: string | null;
  };
  nudge: {
    template: string;
    heard?: string;
    requiredText?: string;
    missingFromHeard?: string[];
    extraInHeard?: string[];
  } | null;
  pricingNote: string | null;
  serviceDiscussed: boolean;
  estimateSpokenWithoutReading: boolean;
  enrollment: {
    medications: string[];
    readback: string;
    confirmed: boolean;
    submitted: boolean;
    resultId: string | null;
    returnedScope: string[] | null;
    scopeOk: boolean | null;
    withdrawn: boolean;
  };
  coverage: {
    caseId: string;
    status: string;
    requestedMedication: string;
    determination: string | null;
  } | null;
  handoffDraft: string;
  wrapDraft: string;
  wrapStable: string;
  transfer: {
    destinationConfirmed: boolean;
    connectionStatus: string | null;
    transferId: string | null;
  };
  disposition: {
    recommended: string | null;
    confirmed: string | null;
  };
  closingNote: string | null;
  closingHistory: Array<{
    text: string;
    stability: string;
    assessment: string;
  }>;
  outcomeReady: boolean;
  warmup: { ok: boolean; ms: number; model: string; at: string } | null;
  lastTimings: TimingRecord[];
  lastInterpretation: Record<string, unknown> | null;
  diagnostics: {
    disclosureFetch: string;
    warmup: string;
    embeddings: string;
    overlay: string;
    pauses: { label: string; durationMs: number }[];
    router: RouterTrace[];
    triggers: TriggerTrace[];
    rechecks: { at: string; fingerprint: string; changed: boolean }[];
  };
};
