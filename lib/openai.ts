import { readFileSync } from "fs";
import http from "http";
import https from "https";
import path from "path";

const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

export function readOpenAiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      if (line.startsWith("OPENAI_API_KEY=")) {
        return line
          .slice("OPENAI_API_KEY=".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no file */
  }
  return "";
}

export const FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-5.6-luna";
export const MID_MODEL = process.env.OPENAI_MID_MODEL || "gpt-5.6-terra";
export const EMBED_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

function post(
  apiPath: string,
  payload: unknown,
): Promise<{ status: number; json: unknown; ms: number }> {
  const body = JSON.stringify(payload);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: apiPath,
        method: "POST",
        agent,
        headers: {
          Authorization: `Bearer ${readOpenAiKey()}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "keep-alive",
        },
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: unknown = {};
          try {
            json = JSON.parse(raw);
          } catch {
            json = { raw };
          }
          resolve({
            status: res.statusCode ?? 500,
            json,
            ms: performance.now() - t0,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export function extractOutputText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const rec = json as Record<string, unknown>;
  if (typeof rec.output_text === "string") return rec.output_text;
  const parts: string[] = [];
  for (const item of (rec.output as unknown[]) ?? []) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content ?? [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const text = (c as { text?: string }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function lunaComplete(input: string, maxOutputTokens = 400) {
  const key = readOpenAiKey();
  if (!key) {
    return { ok: false, ms: 0, model: FAST_MODEL, text: "", usage: null };
  }
  const res = await post("/v1/responses", {
    model: FAST_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: maxOutputTokens,
    input,
  });
  const usage =
    res.json && typeof res.json === "object"
      ? ((res.json as { usage?: unknown }).usage ?? null)
      : null;
  return {
    ok: res.status < 400,
    ms: res.ms,
    model: FAST_MODEL,
    text: extractOutputText(res.json),
    usage,
  };
}

export async function terraComplete(input: string, maxOutputTokens = 700) {
  const key = readOpenAiKey();
  if (!key) {
    return { ok: false, ms: 0, model: MID_MODEL, text: "", usage: null };
  }
  const res = await post("/v1/responses", {
    model: MID_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: maxOutputTokens,
    input,
  });
  const usage =
    res.json && typeof res.json === "object"
      ? ((res.json as { usage?: unknown }).usage ?? null)
      : null;
  return {
    ok: res.status < 400,
    ms: res.ms,
    model: MID_MODEL,
    text: extractOutputText(res.json),
    usage,
  };
}

export async function embedTexts(texts: string[]): Promise<{
  ok: boolean;
  ms: number;
  vectors: number[][];
}> {
  const key = readOpenAiKey();
  if (!key || texts.length === 0) {
    return { ok: false, ms: 0, vectors: [] };
  }
  const res = await post("/v1/embeddings", {
    model: EMBED_MODEL,
    input: texts,
  });
  const data =
    res.json && typeof res.json === "object"
      ? ((res.json as { data?: { embedding: number[] }[] }).data ?? [])
      : [];
  return {
    ok: res.status < 400 && data.length === texts.length,
    ms: res.ms,
    vectors: data.map((d) => d.embedding),
  };
}
