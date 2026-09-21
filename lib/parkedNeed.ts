import type { NeedKind, NeedRecord } from "@/lib/types";
import { namedMedicationsInText } from "@/lib/utteranceRules";

/** Keep the first clear member ask; do not replace it with an interrupt line. */
export function preferNeedQueryText(prev?: string, next?: string) {
  const a = (prev ?? "").trim();
  const b = (next ?? "").trim();
  if (!a) return b || undefined;
  if (!b) return a;
  if (
    /\?/.test(a) &&
    /^(actually first|wait|oh\b|also\b|one sec|hold on)\b/i.test(b)
  ) {
    return a;
  }
  if (/\?/.test(b) && !/\?/.test(a)) return b;
  return a;
}

function isLookupTitle(title: string | undefined) {
  return /^working on it$/i.test(title ?? "");
}

export function needHasRealAnswer(need: NeedRecord | undefined) {
  return Boolean(need?.answer?.body) && !isLookupTitle(need?.answer?.title);
}

/** Match the current member line to a need, including the first long question. */
export function parkedNeedKindForUtterance(
  needs: NeedRecord[],
  text: string,
  extraNames: string[] = [],
): NeedKind | undefined {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  const returnCue =
    /\b(so,? the|what about (that|those)|those amounts|that price|back to (that|it|the))\b/.test(
      t,
    );
  for (const n of needs) {
    if (!n.queryText) continue;
    const q = n.queryText.toLowerCase().replace(/\s+/g, " ").trim();
    if (q === t) return n.kind;
    const vocab = n.queryText
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4);
    const named = namedMedicationsInText(text, [...extraNames, ...vocab]);
    const mentionsParked = named.some((d) =>
      n.queryText!.toLowerCase().includes(d.toLowerCase()),
    );
    if (mentionsParked) return n.kind;
  }
  if (needs.some((n) => n.kind === "refill_status") && /\brefill\b/.test(t)) {
    return "refill_status";
  }
  if (wordCount > 10) return undefined;
  if (returnCue) {
    const parked = needs.find(
      (n) =>
        Boolean(n.queryText) &&
        (needHasRealAnswer(n) ||
          n.status === "deferred" ||
          n.guidance === "deferred_valid" ||
          n.status === "active"),
    );
    return parked?.kind;
  }
  return undefined;
}
