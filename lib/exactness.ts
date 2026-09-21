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

export type WordMarkStatus = "same" | "missing" | "extra";

export type WordMark = {
  word: string;
  status: WordMarkStatus;
};

/**
 * Sequence-aligned word diff (LCS). Marks differing words in place for the
 * required sentence and the heard attempt (§14 / product: differing words marked).
 */
export function alignedWordDiff(
  heard: string,
  required: string,
): {
  requiredMarks: WordMark[];
  heardMarks: WordMark[];
  missingFromHeard: string[];
  extraInHeard: string[];
  /** Consecutive missing runs from the required sentence, for a short left-out line. */
  leftOutPhrases: string[];
} {
  const h = normalizeForExactness(heard).split(" ").filter(Boolean);
  const r = normalizeForExactness(required).split(" ").filter(Boolean);
  const n = h.length;
  const m = r.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] =
        h[i - 1] === r[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matchedH = new Array<boolean>(n).fill(false);
  const matchedR = new Array<boolean>(m).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (h[i - 1] === r[j - 1]) {
      matchedH[i - 1] = true;
      matchedR[j - 1] = true;
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  const requiredMarks: WordMark[] = r.map((word, idx) => ({
    word,
    status: matchedR[idx] ? "same" : "missing",
  }));
  const heardMarks: WordMark[] = h.map((word, idx) => ({
    word,
    status: matchedH[idx] ? "same" : "extra",
  }));
  const missingFromHeard = requiredMarks
    .filter((t) => t.status === "missing")
    .map((t) => t.word);
  const extraInHeard = heardMarks
    .filter((t) => t.status === "extra")
    .map((t) => t.word);
  const leftOutPhrases: string[] = [];
  let run: string[] = [];
  for (const mark of requiredMarks) {
    if (mark.status === "missing") {
      run.push(mark.word);
    } else if (run.length) {
      leftOutPhrases.push(run.join(" "));
      run = [];
    }
  }
  if (run.length) leftOutPhrases.push(run.join(" "));
  return {
    requiredMarks,
    heardMarks,
    missingFromHeard,
    extraInHeard,
    leftOutPhrases,
  };
}

/** Bag kept for call sites; backed by sequence alignment so order is preserved. */
export function wordDiff(
  heard: string,
  required: string,
): {
  missingFromHeard: string[];
  extraInHeard: string[];
} {
  const aligned = alignedWordDiff(heard, required);
  return {
    missingFromHeard: aligned.missingFromHeard,
    extraInHeard: aligned.extraInHeard,
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
