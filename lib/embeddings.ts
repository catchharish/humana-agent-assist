import { embedTexts, EMBED_MODEL } from "@/lib/openai";

export type IndexedDoc = {
  id: string;
  kind: string;
  planId: string | null;
  audience: string;
  effectiveDate: string;
  text: string;
  vector: number[];
};

const g = globalThis as unknown as {
  __haaDocs?: {
    key: string;
    ready: boolean;
    items: IndexedDoc[];
    model: string;
  };
};

const INDEX_KEY = "knowledge-v13";

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

export async function ensureDocumentEmbeddings(origin: string): Promise<{
  ready: boolean;
  count: number;
  model: string;
  httpStatus?: number;
  error?: string | null;
  ms?: number;
}> {
  if (g.__haaDocs?.ready && g.__haaDocs.key === INDEX_KEY) {
    return {
      ready: true,
      count: g.__haaDocs.items.length,
      model: g.__haaDocs.model,
    };
  }
  const search = await fetch(
    `${origin}/api/simulated/scripting/knowledge/search`,
    { method: "POST", cache: "no-store" },
  );
  const json = (await search.json()) as {
    data?: {
      candidates?: Array<{
        id: string;
        kind: string;
        planId: string | null;
        audience: string;
        effectiveDate: string;
        text: string;
      }>;
    };
  };
  const cands = json.data?.candidates ?? [];
  const embedded = await embedTexts(cands.map((c) => c.text));
  if (!embedded.ok) {
    g.__haaDocs = { key: INDEX_KEY, ready: false, items: [], model: EMBED_MODEL };
    return {
      ready: false,
      count: 0,
      model: EMBED_MODEL,
      httpStatus: embedded.httpStatus,
      error: embedded.error,
      ms: embedded.ms,
    };
  }
  g.__haaDocs = {
    key: INDEX_KEY,
    ready: true,
    model: EMBED_MODEL,
    items: cands.map((c, i) => ({ ...c, vector: embedded.vectors[i] })),
  };
  return { ready: true, count: cands.length, model: EMBED_MODEL };
}

export async function rankByQuery(
  query: string,
  remainingIds: string[],
): Promise<{ id: string; score: number }[]> {
  const docs = g.__haaDocs;
  if (!docs?.ready) return remainingIds.map((id) => ({ id, score: 0 }));
  const q = await embedTexts([query]);
  if (!q.ok || !q.vectors[0]) return remainingIds.map((id) => ({ id, score: 0 }));
  const qv = q.vectors[0];
  return remainingIds
    .map((id) => {
      const doc = docs.items.find((d) => d.id === id);
      return { id, score: doc ? cosine(qv, doc.vector) : 0 };
    })
    .sort((a, b) => b.score - a.score);
}

export function documentsReady() {
  return Boolean(g.__haaDocs?.ready);
}
