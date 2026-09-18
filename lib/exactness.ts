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
