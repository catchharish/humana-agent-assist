/**
 * Generated ready answers from knowledge topics + FAQ. Never member-specific.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { writableRoot } from "@/lib/log";
import { embedTexts, terraComplete } from "@/lib/openai";

export type ReadyItem = {
  id: string;
  sourceId: string;
  topic: string;
  answer: string;
  vector: number[];
};

const CACHE = path.join(writableRoot(), ".cache", "ready-answers.json");

const g = globalThis as unknown as {
  __haaReady?: { hash: string; items: ReadyItem[] };
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function grounded(answer: string, source: string): string {
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const src = source.toLowerCase();
  const keep: string[] = [];
  for (const s of sentences) {
    const words = s.toLowerCase().replace(/[^a-z0-9$\s]/g, " ").split(/\s+/).filter(Boolean);
    let ok = false;
    for (let n = Math.min(8, words.length); n >= 5; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const span = words.slice(i, i + n).join(" ");
        if (span.length > 18 && src.includes(span)) {
          ok = true;
          break;
        }
      }
      if (ok) break;
    }
    if (ok) keep.push(s);
  }
  return keep.join(" ");
}

export async function ensureReadyAnswers(origin: string): Promise<{
  ready: boolean;
  count: number;
  hash: string;
}> {
  const search = await fetch(
    `${origin}/api/simulated/scripting/knowledge/search`,
    { method: "POST", cache: "no-store" },
  );
  const json = (await search.json()) as {
    data?: {
      candidates?: Array<{
        id: string;
        text: string;
        kind?: string;
      }>;
    };
  };
  const cands = (json.data?.candidates ?? []).filter(
    (candidate) => candidate.kind !== "disposition",
  );
  const hash = createHash("sha256")
    .update(cands.map((c) => c.id + c.text).join("\n"))
    .digest("hex");
  if (g.__haaReady?.hash === hash && g.__haaReady.items.length) {
    return { ready: true, count: g.__haaReady.items.length, hash };
  }
  if (existsSync(CACHE)) {
    try {
      const disk = JSON.parse(readFileSync(CACHE, "utf8")) as {
        hash: string;
        items: Array<Omit<ReadyItem, "vector"> & { vector?: number[] }>;
      };
      if (disk.hash === hash && disk.items.length) {
        const needEmbed = disk.items.filter((i) => !i.vector?.length);
        if (needEmbed.length === 0) {
          g.__haaReady = {
            hash,
            items: disk.items as ReadyItem[],
          };
          return { ready: true, count: disk.items.length, hash };
        }
      }
    } catch {
      /* rebuild */
    }
  }

  const drafted: Array<Omit<ReadyItem, "vector">> = [];
  for (const c of cands) {
    if (c.id.includes("FAQ")) {
      const blocks = c.text.split(/\nQ:\s*/).filter(Boolean);
      let n = 0;
      for (const b of blocks) {
        const [q, ...rest] = b.split(/\nA:\s*/);
        const a = rest.join("A:").trim();
        if (q && a) {
          n += 1;
          drafted.push({
            id: `${c.id}#${n}`,
            sourceId: c.id,
            topic: q.trim(),
            answer: a.trim(),
          });
        }
      }
      continue;
    }
    const terra = await terraComplete(
      `Write 1-2 short advocate-facing sentences on this document's main point. Use only words/facts from the source. No member names, no dollar amounts unless they appear in the source. Source id ${c.id}:\n${c.text}`,
      220,
    );
    const raw = terra.ok ? terra.text : "";
    const answer = grounded(raw, c.text);
    if (answer) {
      drafted.push({
        id: `${c.id}#topic`,
        sourceId: c.id,
        topic: c.id,
        answer,
      });
    }
  }

  const embedded = await embedTexts(drafted.map((d) => `${d.topic}\n${d.answer}`));
  const items: ReadyItem[] = drafted.map((d, i) => ({
    ...d,
    vector: embedded.ok ? embedded.vectors[i] ?? [] : [],
  }));
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ hash, items }, null, 2));
  g.__haaReady = { hash, items };
  return { ready: embedded.ok, count: items.length, hash };
}

export async function lookupReadyAnswers(query: string, k = 3) {
  const pack = g.__haaReady;
  if (!pack?.items.length) return [];
  const q = await embedTexts([query]);
  if (!q.ok || !q.vectors[0]) return [];
  const qv = q.vectors[0];
  return [...pack.items]
    .map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      topic: item.topic,
      answer: item.answer,
      score: cosine(qv, item.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((h) => h.score > 0.25);
}
