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
  | "coverage_status"
  | "unrecognized_request"
  | "unsupported_work";

export type NeedAnswer = {
  title: string;
  body: string;
  sourceLabel: string;
  causeSupported?: boolean;
  chargesEstablished?: boolean;
  statements?: import("@/lib/citations").CitedStatement[];
  at?: string;
  generation?: number;
};

export type ActionResult = {
  kind: string;
  title: string;
  body: string;
  sourceLabel: string;
  at: string;
};

export type NeedRecord = {
  kind: NeedKind;
  status: "requested" | "active" | "deferred" | "resolved" | "unresolved_gap";
  guidance: "preparing" | "ready" | "deferred_valid" | "invalidated";
  flowStep: string;
  fingerprint?: string;
  queryText?: string;
  sourceUtteranceId?: string;
  answer?: NeedAnswer;
  answerHistory?: NeedAnswer[];
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

export type UtteranceRules = import("@/lib/utteranceRules").UtteranceRules;

export type SessionState = {
  sessionId: string;
  startedAt: number;
  elapsedMs: number;
  paused: boolean;
  pauseStartedAt: number | null;
  totalPauseMs: number;
  lastPauseLabel: string | null;
  selectedMemberId: string;
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
    serviceGuide: {
      articleId: string;
      displayName: string;
      body: string;
    } | null;
    objection: {
      articleId: string;
      body: string;
    } | null;
    prescriptions: Array<{ drugName: string }>;
    contactPreferences: {
      doNotContact: boolean;
      mailServiceEnrolled: boolean;
    } | null;
  } | null;
  callType: string;
  currentNeed: string;
  flowStep: string;
  nowPriority: number;
  greetingLocked: boolean;
  closingLocked: boolean;
  greetingBuffer: { speaker: string; parts: string[]; lastId: string } | null;
  greetingDeadlineAt: number | null;
  pricingExactOffset: number | null;
  identityStatus: string;
  auth: AuthResult | null;
  member: MemberBrief | null;
  ivrReason: string | null;
  greeting: ObligationStatus;
  pricing: ObligationStatus;
  closing: ObligationStatus;
  greetingSource: string;
  disclosures: DisclosureRequirement[];
  utteranceRules: import("@/lib/utteranceRules").UtteranceRules | null;
  transcript: TranscriptLine[];
  needs: NeedRecord[];
  actionResults: ActionResult[];
  nowCardOrigin?: "answer" | "action" | "system";
  nowCardNeedKind?: NeedKind | null;
  nowCard: {
    title: string;
    body: string;
    sourceLabel: string;
    waitingForFocus?: boolean;
    liveSteps?: string[];
    earlyFacts?: { text: string; source: string }[];
    statements?: import("@/lib/citations").CitedStatement[];
    canRetry?: boolean;
    retryCause?: string | null;
  };
  recommendation: {
    kind: string;
    title: string;
    body: string;
    reasons?: string[];
    facts?: string[];
    playbookIds?: string[];
    considered?: { action: string; whyNot: string }[];
    preferredVsMail?: string;
    advocateControl?: "offer_dismiss" | "confirm_transfer";
    marksPricingUpcoming?: boolean;
    sourceLabel: string;
    playbookPassage?: string;
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
  nbaDismissedThisCall: boolean;
  consent: {
    comparison: "none" | "hedge" | "absolute_yes";
    enrollment: "none" | "hedge" | "absolute_yes";
    clarification: string | null;
    comparisonScopeKey: string | null;
    enrollmentScopeKey: string | null;
    comparisonUtteranceId: string | null;
    enrollmentUtteranceId: string | null;
    clarificationShown: boolean;
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
    scopeChangedAt: number;
  };
  coverage: {
    caseId: string;
    status: string;
    requestedMedication: string;
    determination: string | null;
  } | null;
  handoffDraft: string;
  handoffLines?: import("@/lib/citations").CitedStatement[];
  wrapDraft: string;
  wrapLines?: import("@/lib/citations").CitedStatement[];
  wrapStable: string;
  flaggedIssues: Array<{ at: string; note: string }>;
  openEvidence: {
    title: string;
    body: string;
    sourceLabel: string;
    highlight?: string;
  } | null;
  retrievedSources: import("@/lib/citations").RetrievedSource[];
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
  warmup: {
    ok: boolean;
    ms: number;
    model: string;
    at: string;
    httpStatus?: number;
    error?: string | null;
  } | null;
  lastTimings: TimingRecord[];
  lunaSeq: number;
  lastInterpretation: Record<string, unknown> | null;
  lastAppliedEventId: string | null;
  lastAnswerQuestion: string | null;
  modelHealth: {
    luna: {
      ok: boolean;
      status: number;
      error: string | null;
      ms: number;
      at: string;
    } | null;
    terra: {
      ok: boolean;
      status: number;
      error: string | null;
      ms: number;
      at: string;
    } | null;
  };
  answerLoopGeneration: number;
  answerLoopAnchor: {
    generation: number;
    question: string;
    needKind?: NeedKind;
    sourceUtteranceId?: string;
    enrollmentConsent: string;
    enrollmentScopeKey: string;
  } | null;
  pendingNba: string | null;
  diagnostics: {
    disclosureFetch: string;
    warmup: string;
    embeddings: string;
    overlay: string;
    pauses: { label: string; durationMs: number }[];
    router: RouterTrace[];
    triggers: TriggerTrace[];
    rechecks: { at: string; fingerprint: string; changed: boolean }[];
    needPaths: Array<{
      eventId: string;
      need: string;
      path: "code_rule" | "luna";
    }>;
      pauseSnapshots: Array<{
      label: string;
      nowTitle: string;
      nowBody: string;
      historicalGuidance: string | null;
      historicalStatus: string | null;
    }>;
    nba: Record<string, unknown>[];
    supportCheckMs?: number;
  };
};
