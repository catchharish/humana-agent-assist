export type UtteranceRules = {
  ruleSetId: string;
  ninetyDayDuration: string[];
  ninetyDayQuestionCue: string[];
  ninetyDayExclude: string[];
  advocateServiceIntro: string[];
  comparisonHedge: string[];
  comparisonAbsolute: string[];
  scopedComparisonAsk: string[];
  compoundQuestion: string[];
  readyForPickup: string[];
  splitElection: string[];
  enrollmentAbsolute: string[];
  withdraw: string[];
  firmRefusal: string[];
};

export function matchesAny(patterns: string[] | undefined, text: string) {
  const sample = text.trim();
  return (patterns ?? []).some((p) => new RegExp(p, "i").test(sample));
}

export function matchesAll(patterns: string[] | undefined, text: string) {
  const sample = text.trim();
  const list = patterns ?? [];
  if (list.length === 0) return false;
  return list.every((p) => new RegExp(p, "i").test(sample));
}

export function quoteAmountsMayRender(comparison: string) {
  return comparison === "absolute_yes";
}

export function isNinetyDayQuestion(
  rules: UtteranceRules | null,
  text: string,
): boolean {
  if (!rules) return false;
  if (matchesAny(rules.ninetyDayExclude, text)) return false;
  return (
    matchesAny(rules.ninetyDayDuration, text) &&
    matchesAny(rules.ninetyDayQuestionCue, text)
  );
}

export type ComparisonCodeDecision = "absolute_yes" | "hedge" | "wait";

const AFFIRM =
  /^(yes|yeah|yep|sure|please|absolutely|ok|okay|go ahead|i(?:['’]d| would) like that)([,.]|\s|$)/i;

const AFFIRM_REJECT =
  /\b(but|not|no|wait|later|think|actually)\b|\?/i;

export function namedMedicationsInText(
  text: string,
  allowed: string[] = [],
): string[] {
  const lower = text.toLowerCase();
  return [
    ...new Set(
      allowed.filter((n) => n && lower.includes(n.toLowerCase())),
    ),
  ];
}

export type EnrollmentCodeDecision =
  | "absolute_yes"
  | "hedge"
  | "clarify"
  | "wait";

/** Enrollment yes: member final, no hedge, pending matching readback, named meds = draft or none. */
export function classifyEnrollmentConsent(args: {
  rules: UtteranceRules | null;
  speaker: string;
  text: string;
  stability: string;
  draftMedications: string[];
  readback: string;
  readbackPending: boolean;
}): EnrollmentCodeDecision {
  if (args.speaker !== "member") return "wait";
  if (args.stability !== "final" && args.stability !== "corrected") return "wait";
  if (args.draftMedications.length === 0 || !args.readback.trim()) return "wait";
  if (!args.readbackPending) return "wait";
  if (matchesAny(args.rules?.comparisonHedge, args.text)) return "hedge";
  const named = namedMedicationsInText(args.text, args.draftMedications);
  if (
    args.draftMedications.length === 1 &&
    /\bboth\b|\ball of them\b|\bthe other\b/i.test(args.text)
  ) {
    return "clarify";
  }
  if (named.length > 0) {
    const want = new Set(args.draftMedications.map((m) => m.toLowerCase()));
    const got = new Set(named.map((m) => m.toLowerCase()));
    if (want.size !== got.size || [...want].some((m) => !got.has(m))) {
      return "clarify";
    }
  }
  const trimmed = args.text.trim();
  if (!AFFIRM.test(trimmed)) return "wait";
  if (AFFIRM_REJECT.test(trimmed)) return "wait";
  const rest = trimmed
    .replace(AFFIRM, "")
    .replace(/\b(please|go ahead|thanks|thank you|for)\b/gi, " ")
    .replace(/[.,]/g, " ")
    .trim();
  const restNames = namedMedicationsInText(rest, args.draftMedications);
  const leftover = rest
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (w) => !restNames.some((n) => n.toLowerCase() === w.toLowerCase()),
    )
    .filter((w) => !/^(only|just)$/i.test(w));
  if (leftover.length > 0) return "clarify";
  return "absolute_yes";
}

export type NamedPharmacy = { id: string; name: string };

function normalizePharm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function slugifyPharmacy(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(the|pharmacy|drugstore|chemist)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pharmacyMentioned(text: string, p: NamedPharmacy): boolean {
  const n = normalizePharm(text);
  if (!n) return false;
  const name = normalizePharm(p.name);
  const id = normalizePharm(p.id.replace(/-/g, " "));
  if (name && n.includes(name)) return true;
  if (id && n.includes(id)) return true;
  const words = name
    .split(" ")
    .filter((w) => w.length > 3 && w !== "pharmacy");
  return words.length > 0 && words.every((w) => n.includes(w));
}

/** Split “not X — Y”, “Y instead of X”, and nearby correction phrasings. */
export function splitPharmacyCorrection(text: string): {
  denied: string;
  replacement: string;
} {
  const t = text.trim();
  const dash = /\b(?:not|no longer)\s+(.+?)\s*[—–\-]\s*(.+)$/i.exec(t);
  if (dash) return { denied: dash[1].trim(), replacement: dash[2].trim() };
  const insteadOf = /(.+?)\s+instead of\s+(.+?)(?:[.?!]|$)/i.exec(t);
  if (insteadOf) {
    return {
      denied: insteadOf[2].trim(),
      replacement: insteadOf[1].trim(),
    };
  }
  const notInstead =
    /\b(?:not|no longer)\s+(.+?)(?:,|\s+)\s*(.+?)\s+instead\b/i.exec(t);
  if (notInstead) {
    return { denied: notInstead[1].trim(), replacement: notInstead[2].trim() };
  }
  const insteadComma = /\binstead of\s+(.+?)[,;]\s*(.+)$/i.exec(t);
  if (insteadComma) {
    return {
      denied: insteadComma[1].trim(),
      replacement: insteadComma[2].trim(),
    };
  }
  const notOnly = /\b(?:not|no longer)\s+(.+?)$/i.exec(t);
  if (notOnly) return { denied: notOnly[1].trim(), replacement: "" };
  return { denied: "", replacement: "" };
}

function matchPharmacies(blob: string, pharmacies: NamedPharmacy[]): string[] {
  if (!blob.trim()) return [];
  const hits = pharmacies
    .filter((p) => pharmacyMentioned(blob, p))
    .map((p) => p.id);
  const slug = slugifyPharmacy(blob);
  if (slug && !hits.includes(slug)) hits.push(slug);
  return hits;
}

export function deniedPharmacyIds(
  text: string,
  pharmacies: NamedPharmacy[] = [],
): Set<string> {
  const { denied } = splitPharmacyCorrection(text);
  return new Set(matchPharmacies(denied, pharmacies));
}

export function pharmacyIdFromText(
  text: string,
  pharmacies: NamedPharmacy[] = [],
): string | undefined {
  const { denied, replacement } = splitPharmacyCorrection(text);
  const deniedIds = new Set(matchPharmacies(denied, pharmacies));
  const search = replacement || (denied ? "" : text);
  if (!search.trim()) return undefined;
  const hits = matchPharmacies(search, pharmacies).filter(
    (id) => !deniedIds.has(id),
  );
  return hits[0];
}

function lunaMatchesPharmacy(
  lunaPharmacy: string,
  pharmacies: NamedPharmacy[],
): string | undefined {
  const blob = lunaPharmacy.trim();
  if (!blob) return undefined;
  const direct = pharmacies.find(
    (p) =>
      p.id.toLowerCase() === blob.toLowerCase() ||
      pharmacyMentioned(blob, p),
  );
  return direct?.id ?? slugifyPharmacy(blob) ?? undefined;
}

/** Utterance-named pharmacy wins; a denied pharmacy is never re-fetched. */
export function resolveQuotePharmacyId(
  text: string,
  lunaPharmacy: string | null,
  pharmacies: NamedPharmacy[] = [],
): string | undefined {
  const fromText = pharmacyIdFromText(text, pharmacies);
  if (fromText) return fromText;
  if (!lunaPharmacy) return undefined;
  if (deniedPharmacyIds(text, pharmacies).has(lunaPharmacy)) return undefined;
  const mapped = lunaMatchesPharmacy(lunaPharmacy, pharmacies);
  if (!mapped) return undefined;
  if (deniedPharmacyIds(text, pharmacies).has(mapped)) {
    return undefined;
  }
  return mapped;
}

export function isDirectNamedQuoteAsk(
  text: string,
  entities: { drugs: string[]; pharmacies: string[] },
): boolean {
  const requestCue =
    /\b(estimate|quote|price|cost|how much)\b/i.test(text) &&
    /\b(want|need|give|tell|please|can you|could you|what(?:'s| is)|how much)\b/i.test(
      text,
    );
  if (!requestCue) return false;
  if (/\b(don'?t|do not|never|not|no)\b/i.test(text)) return false;
  if (
    /\b(last month|yesterday|already|paid|charged|cost more|did .+ cost)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  const lower = text.toLowerCase();
  const namedDrug = entities.drugs.some((d) => lower.includes(d.toLowerCase()));
  const namedPharm = entities.pharmacies.some((p) =>
    lower.includes(p.toLowerCase()),
  );
  return namedDrug || namedPharm;
}

export function classifyComparisonConsent(args: {
  rules: UtteranceRules | null;
  speaker: string;
  text: string;
  stability: string;
  optionalWorkSuppressed: boolean;
  scopedPending: boolean;
  lastAdvocate: string;
}): ComparisonCodeDecision {
  if (args.optionalWorkSuppressed) return "wait";
  if (args.speaker !== "member") return "wait";
  if (!args.rules) return "wait";
  if (args.stability !== "final" && args.stability !== "corrected") return "wait";
  if (matchesAny(args.rules.comparisonHedge, args.text)) return "hedge";
  if (matchesAny(args.rules.compoundQuestion, args.lastAdvocate)) return "hedge";
  if (
    args.scopedPending &&
    matchesAny(args.rules.comparisonAbsolute, args.text)
  ) {
    return "absolute_yes";
  }
  return "wait";
}
