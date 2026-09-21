/** Display names for cards the system already produced. Not a router. */

export const HUMANA_KIND = {
  legal: "Legal disclaimer",
  answer: "Answer",
  tellCustomer: "Tell customer",
  nba: "Next best action",
  objection: "Objection rebuttal",
  enrollment: "Enrollment",
  transfer: "Warm transfer",
  disposition: "Disposition code",
} as const;

export type HumanaKind = (typeof HUMANA_KIND)[keyof typeof HUMANA_KIND];

export function kindFromPlaybook(passage?: string, pillName?: string): HumanaKind {
  const named = (/Kind:\s*([^\n.]+)/i.exec(passage ?? "")?.[1] ?? "")
    .trim()
    .toLowerCase();
  if (named.includes("objection")) return HUMANA_KIND.objection;
  if (named.includes("next best")) return HUMANA_KIND.nba;
  const blob = `${pillName ?? ""} ${passage ?? ""}`.toLowerCase();
  if (blob.includes("objection") || blob.includes("rebuttal") || blob.includes("reply to a concern")) {
    return HUMANA_KIND.objection;
  }
  return HUMANA_KIND.nba;
}

export function humanaKindForCard(
  cardKind: string,
  rec?: { playbookPassage?: string; pillName?: string } | null,
  opts?: { tellCustomer?: boolean },
): HumanaKind | null {
  if (cardKind === "legal") return HUMANA_KIND.legal;
  if (cardKind === "answer" && opts?.tellCustomer) return HUMANA_KIND.tellCustomer;
  if (cardKind === "answer") return HUMANA_KIND.answer;
  if (cardKind === "enrollment") return HUMANA_KIND.enrollment;
  if (cardKind === "transfer") return HUMANA_KIND.transfer;
  if (cardKind === "wrap") return HUMANA_KIND.disposition;
  if (cardKind === "suggestion") return kindFromPlaybook(rec?.playbookPassage, rec?.pillName);
  return null;
}

function isMemberRecordTag(tag: string) {
  const l = tag.toLowerCase();
  return /claim|pharmacy system|eligib|coverage|prescription|refill|directory|enrollment/.test(
    l,
  );
}

function isKnowledgeTag(tag: string) {
  const l = tag.toLowerCase();
  return /plan|policy|rule|playbook|guidance|script|knowledge|document|cost-share|ready answer/.test(
    l,
  );
}

/** One line from the sources this answer actually cited. */
export function fromAnswerSources(
  sources: Array<{ tag?: string }>,
): string {
  let records = false;
  let knowledge = false;
  for (const s of sources) {
    const tag = s.tag ?? "";
    if (isMemberRecordTag(tag)) records = true;
    if (isKnowledgeTag(tag)) knowledge = true;
  }
  if (records && knowledge) return "From user records and Humana's knowledge";
  if (records) return "From user records";
  if (knowledge) return "From Humana's knowledge";
  return "";
}
