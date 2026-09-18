/** Exactness ignores punctuation/capitalization only (§12.4 / §15). */
export function normalizeForExactness(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExactReading(heard: string, required: string): boolean {
  return normalizeForExactness(heard) === normalizeForExactness(required);
}

export function wordDiff(heard: string, required: string): {
  missingFromHeard: string[];
  extraInHeard: string[];
} {
  const h = normalizeForExactness(heard).split(" ").filter(Boolean);
  const r = normalizeForExactness(required).split(" ").filter(Boolean);
  return {
    missingFromHeard: r.filter((w) => !h.includes(w)),
    extraInHeard: h.filter((w) => !r.includes(w)),
  };
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "be",
  "to",
  "of",
  "and",
  "or",
  "for",
  "in",
  "on",
  "at",
  "this",
  "that",
  "it",
  "your",
  "you",
  "we",
  "i",
]);

export function contentWords(text: string): string[] {
  return normalizeForExactness(text)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

/** Heard is a prefix of required, or required is a prefix of heard (one reading in progress). */
export function isPrefixOfReading(heard: string, required: string): boolean {
  const h = normalizeForExactness(heard);
  const r = normalizeForExactness(required);
  if (!h || !r) return false;
  return r.startsWith(h) || h.startsWith(r);
}

/**
 * Combine adjacent same-speaker final/corrected advocate segments of one reading (§12.4).
 * Stop at another speaker, uncertain speech, or a segment that is not part of this reading.
 */
export function stitchedReading(
  transcript: Array<{
    id: string;
    speaker: string;
    stability: string;
    text: string;
  }>,
  current: { id: string; speaker: string; stability: string; text: string },
  required: string,
): string {
  if (current.speaker !== "advocate") return current.text;
  const idx = transcript.findIndex((t) => t.id === current.id);
  const parts = [current.text];
  if (idx < 0) return current.text;
  for (let i = idx - 1; i >= 0; i--) {
    const t = transcript[i];
    if (t.stability === "partial") continue;
    if (t.speaker !== "advocate") break;
    if (t.stability === "uncertain") break;
    if (t.stability !== "final" && t.stability !== "corrected") break;
    const trial = `${t.text} ${parts.join(" ")}`;
    if (
      !isExactReading(trial, required) &&
      !isPrefixOfReading(trial, required)
    ) {
      break;
    }
    parts.unshift(t.text);
  }
  return parts.join(" ");
}
export function isWordingAttempt(
  heard: string,
  required: string,
  threshold = 0.45,
): boolean {
  const req = contentWords(required);
  if (req.length === 0) return false;
  const heardSet = new Set(contentWords(heard));
  const hit = req.filter((w) => heardSet.has(w)).length;
  return hit / req.length >= threshold;
}
