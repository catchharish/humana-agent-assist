import { readFileSync } from "fs";
import http from "http";
import https from "https";
import path from "path";
import { appendOpenAiHttp } from "./log";

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

export type OpenAiHeaderBag = {
  retryAfter: string | null;
  requestId: string | null;
  ratelimitLimitRequests: string | null;
  ratelimitRemainingRequests: string | null;
  ratelimitResetRequests: string | null;
  ratelimitLimitTokens: string | null;
  ratelimitRemainingTokens: string | null;
  ratelimitResetTokens: string | null;
};

export function openAiHeaderBag(res: http.IncomingMessage): OpenAiHeaderBag {
  const pick = (k: string) => {
    const v = res.headers[k];
    if (Array.isArray(v)) return v.join(",");
    return v ?? null;
  };
  return {
    retryAfter: pick("retry-after"),
    requestId: pick("x-request-id"),
    ratelimitLimitRequests: pick("x-ratelimit-limit-requests"),
    ratelimitRemainingRequests: pick("x-ratelimit-remaining-requests"),
    ratelimitResetRequests: pick("x-ratelimit-reset-requests"),
    ratelimitLimitTokens: pick("x-ratelimit-limit-tokens"),
    ratelimitRemainingTokens: pick("x-ratelimit-remaining-tokens"),
    ratelimitResetTokens: pick("x-ratelimit-reset-tokens"),
  };
}

export function extractOpenAiError(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as Record<string, unknown>;
  const err = rec.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") return JSON.stringify(err);
  if (typeof rec.raw === "string" && rec.raw.trim()) return rec.raw.slice(0, 8000);
  return null;
}

export function logOpenAiHttp(rec: {
  kind: string;
  model?: string;
  path?: string;
  status: number;
  ms: number;
  error?: string | null;
  headers?: OpenAiHeaderBag | null;
  serviceTier?: string | null;
  ok?: boolean;
}) {
  appendOpenAiHttp(rec);
  if (rec.status >= 400 || rec.error) {
    console.error(
      JSON.stringify({
        openai_http: rec.kind,
        status: rec.status,
        model: rec.model,
        error: rec.error ?? null,
        ms: Math.round(rec.ms),
        retryAfter: rec.headers?.retryAfter ?? null,
        requestId: rec.headers?.requestId ?? null,
      }),
    );
  }
}

function post(
  apiPath: string,
  payload: unknown,
  kind: string,
): Promise<{
  status: number;
  json: unknown;
  ms: number;
  headers: OpenAiHeaderBag;
}> {
  const body = JSON.stringify(payload);
  const t0 = performance.now();
  const model =
    payload && typeof payload === "object"
      ? String((payload as { model?: string }).model ?? "")
      : "";
  const serviceTier =
    payload && typeof payload === "object"
      ? String((payload as { service_tier?: string }).service_tier ?? "") || null
      : null;
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
        const headers = openAiHeaderBag(res);
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
          const status = res.statusCode ?? 500;
          const error = extractOpenAiError(json);
          logOpenAiHttp({
            kind,
            model,
            path: apiPath,
            status,
            ms: performance.now() - t0,
            error,
            headers,
            serviceTier,
            ok: status < 400,
          });
          resolve({
            status,
            json,
            ms: performance.now() - t0,
            headers,
          });
        });
      },
    );
    req.on("error", (err) => {
      logOpenAiHttp({
        kind,
        model,
        path: apiPath,
        status: 0,
        ms: performance.now() - t0,
        error: String(err),
        headers: null,
        serviceTier,
        ok: false,
      });
      reject(err);
    });
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
  httpStatus: number;
  error: string | null;
  headers: OpenAiHeaderBag | null;
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
      httpStatus: 0,
      error: "missing_api_key",
      headers: null,
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
    let settled = false;
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
        let error: string | null = null;
        const headers = openAiHeaderBag(res);
        const status = res.statusCode ?? 500;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (!error && status >= 400) {
            error = buf.trim().slice(0, 8000) || `http_${status}`;
          }
          const ok = status < 400 && Boolean(text);
          logOpenAiHttp({
            kind: "luna_stream",
            model: FAST_MODEL,
            path: "/v1/responses",
            status,
            ms: performance.now() - t0,
            error: error || (ok ? null : "empty_body"),
            headers,
            serviceTier: opts.serviceTier ?? null,
            ok,
          });
          resolve({
            ok,
            ms: performance.now() - t0,
            ttftMs,
            text,
            usage,
            model: FAST_MODEL,
            httpStatus: status,
            error,
            headers,
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
                error = extractOpenAiError(errJson);
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
            if (type === "error") {
              error = extractOpenAiError(ev) ?? JSON.stringify(ev);
            }
            if (type === "response.failed") {
              const resp = ev.response as { error?: unknown } | undefined;
              error =
                extractOpenAiError(resp ?? ev) ??
                extractOpenAiError({ error: resp?.error }) ??
                error;
            }
            if (type === "response.output_text.delta") {
              const delta = String(ev.delta ?? "");
              if (delta) {
                if (ttftMs == null) ttftMs = performance.now() - t0;
                text += delta;
                if (opts.onDelta?.(text)) {
                  finish();
                  req.destroy();
                  return;
                }
              }
            }
            if (type === "response.output_text.done") {
              const done = String(ev.text ?? "");
              if (done && !text) {
                if (ttftMs == null) ttftMs = performance.now() - t0;
                text = done;
                if (opts.onDelta?.(text)) {
                  finish();
                  req.destroy();
                  return;
                }
              }
            }
            if (type === "response.completed") {
              const resp = ev.response as { usage?: unknown } | undefined;
              usage = usageFrom(resp ?? ev);
            }
          }
        });
        res.on("end", finish);
        res.on("error", (err) => {
          if (settled) return;
          error = String(err);
          finish();
        });
      },
    );
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      logOpenAiHttp({
        kind: "luna_stream",
        model: FAST_MODEL,
        path: "/v1/responses",
        status: 0,
        ms: performance.now() - t0,
        error: String(err),
        headers: null,
        serviceTier: opts.serviceTier ?? null,
        ok: false,
      });
      resolve({
        ok: false,
        ms: performance.now() - t0,
        ttftMs: null,
        text: "",
        usage: null,
        model: FAST_MODEL,
        httpStatus: 0,
        error: String(err),
        headers: null,
      });
    });
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
    httpStatus: streamed.httpStatus,
    error: streamed.error,
    headers: streamed.headers,
  };
}

export async function terraComplete(
  input: string,
  maxOutputTokens = 700,
  serviceTier?: "priority" | "fast",
) {
  const key = readOpenAiKey();
  if (!key) {
    return {
      ok: false,
      ms: 0,
      model: MID_MODEL,
      text: "",
      usage: null,
      httpStatus: 0,
      error: "missing_api_key",
      headers: null,
    };
  }
  const payload: Record<string, unknown> = {
    model: MID_MODEL,
    reasoning: { effort: "none" },
    max_output_tokens: maxOutputTokens,
    input,
  };
  if (serviceTier) payload.service_tier = serviceTier;
  const res = await Promise.race([
    post("/v1/responses", payload, "terra_complete"),
    new Promise<{
      status: number;
      json: unknown;
      ms: number;
      headers: OpenAiHeaderBag | null;
    }>((resolve) => {
      setTimeout(
        () =>
          resolve({
            status: 504,
            json: { error: { message: "client_timeout_8s", type: "timeout" } },
            ms: 8000,
            headers: null,
          }),
        8000,
      );
    }),
  ]);
  if (
    res.status === 504 &&
    extractOpenAiError(res.json)?.includes("client_timeout_8s")
  ) {
    logOpenAiHttp({
      kind: "terra_complete",
      model: MID_MODEL,
      path: "/v1/responses",
      status: 504,
      ms: res.ms,
      error: "client_timeout_8s",
      headers: null,
      serviceTier: serviceTier ?? null,
      ok: false,
    });
  }
  const usage =
    res.json && typeof res.json === "object"
      ? ((res.json as { usage?: unknown }).usage ?? null)
      : null;
  const error = res.status >= 400 ? extractOpenAiError(res.json) : null;
  return {
    ok: res.status < 400,
    ms: res.ms,
    model: MID_MODEL,
    text: extractOutputText(res.json),
    usage,
    httpStatus: res.status,
    error,
    headers: "headers" in res ? res.headers : null,
  };
}

export async function embedTexts(texts: string[]): Promise<{
  ok: boolean;
  ms: number;
  vectors: number[][];
  httpStatus: number;
  error: string | null;
  headers: OpenAiHeaderBag | null;
}> {
  const key = readOpenAiKey();
  if (!key || texts.length === 0) {
    return {
      ok: false,
      ms: 0,
      vectors: [],
      httpStatus: 0,
      error: key ? "empty_input" : "missing_api_key",
      headers: null,
    };
  }
  const res = await post(
    "/v1/embeddings",
    {
      model: EMBED_MODEL,
      input: texts,
    },
    "embeddings",
  );
  const data =
    res.json && typeof res.json === "object"
      ? ((res.json as { data?: { embedding: number[] }[] }).data ?? [])
      : [];
  return {
    ok: res.status < 400 && data.length === texts.length,
    ms: res.ms,
    vectors: data.map((d) => d.embedding),
    httpStatus: res.status,
    error: res.status >= 400 ? extractOpenAiError(res.json) : null,
    headers: res.headers,
  };
}
