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

export type LunaUsage = {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
};

export type LunaStreamResult = {
  ok: boolean;
  ms: number;
  ttftMs: number | null;
  text: string;
  usage: LunaUsage | null;
  model: string;
};

function usageFrom(json: unknown): LunaUsage | null {
  if (!json || typeof json !== "object") return null;
  const u = (json as { usage?: Record<string, unknown> }).usage;
  if (!u) return null;
  const details = (u.input_tokens_details ?? u.prompt_tokens_details) as
    | Record<string, unknown>
    | undefined;
  return {
    input_tokens: Number(u.input_tokens ?? u.prompt_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? u.completion_tokens ?? 0),
    cached_tokens: Number(details?.cached_tokens ?? 0),
  };
}

export async function lunaStream(opts: {
  input: unknown;
  maxOutputTokens: number;
  promptCacheKey?: string;
  serviceTier?: "priority" | "fast";
  onDelta?: (acc: string) => boolean | void;
}): Promise<LunaStreamResult> {
  const key = readOpenAiKey();
  if (!key) {
    return {
      ok: false,
      ms: 0,
      ttftMs: null,
      text: "",
      usage: null,
      model: FAST_MODEL,
    };
  }
  const payload: Record<string, unknown> = {
    model: FAST_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: opts.maxOutputTokens,
    input: opts.input,
    stream: true,
  };
  if (opts.promptCacheKey) payload.prompt_cache_key = opts.promptCacheKey;
  if (opts.serviceTier) payload.service_tier = opts.serviceTier;
  const body = JSON.stringify(payload);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/responses",
        method: "POST",
        agent,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "keep-alive",
        },
      },
      (res: http.IncomingMessage) => {
        let buf = "";
        let text = "";
        let ttftMs: number | null = null;
        let usage: LunaUsage | null = null;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            ok: (res.statusCode ?? 500) < 400 || Boolean(text),
            ms: performance.now() - t0,
            ttftMs,
            text,
            usage,
            model: FAST_MODEL,
          });
        };
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          if (buf.includes("{") && !buf.includes("data:")) {
            try {
              const errJson = JSON.parse(buf) as {
                error?: { message?: string };
                usage?: unknown;
              };
              if (errJson.error) {
                usage = usageFrom(errJson);
                finish();
                return;
              }
            } catch {
              /* still accumulating SSE */
            }
          }
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }
            const type = String(ev.type ?? "");
            if (type === "response.output_text.delta") {
              const delta = String(ev.delta ?? "");
              if (delta) {
                if (ttftMs == null) ttftMs = performance.now() - t0;
                text += delta;
                opts.onDelta?.(text);
              }
            }
            if (type === "response.output_text.done") {
              const done = String(ev.text ?? "");
              if (done && !text) {
                if (ttftMs == null) ttftMs = performance.now() - t0;
                text = done;
                opts.onDelta?.(text);
              }
            }
            if (type === "response.completed") {
              const resp = ev.response as { usage?: unknown } | undefined;
              usage = usageFrom(resp ?? ev);
            }
          }
        });
        res.on("end", finish);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function lunaComplete(input: string, maxOutputTokens = 400) {
  const streamed = await lunaStream({ input, maxOutputTokens });
  return {
    ok: streamed.ok,
    ms: streamed.ms,
    ttftMs: streamed.ttftMs,
    model: streamed.model,
    text: streamed.text,
    usage: streamed.usage,
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
