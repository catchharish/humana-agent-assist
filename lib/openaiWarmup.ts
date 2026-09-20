import http from "http";
import https from "https";
import {
  extractOpenAiError,
  FAST_MODEL,
  logOpenAiHttp,
  openAiHeaderBag,
  readOpenAiKey,
} from "@/lib/openai";

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

export async function warmupLuna(): Promise<{
  ok: boolean;
  ms: number;
  model: string;
  httpStatus: number;
  error: string | null;
}> {
  const key = readOpenAiKey();
  const model = FAST_MODEL;
  if (!key) {
    return { ok: false, ms: 0, model, httpStatus: 0, error: "missing_api_key" };
  }
  const payload = JSON.stringify({
    model,
    reasoning: { effort: "none" },
    max_output_tokens: 16,
    input: "warmup",
  });
  const t0 = performance.now();
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/responses",
        method: "POST",
        agent,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
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
          const error = status >= 400 ? extractOpenAiError(json) : null;
          const ms = performance.now() - t0;
          logOpenAiHttp({
            kind: "luna_warmup",
            model,
            path: "/v1/responses",
            status,
            ms,
            error,
            headers,
            ok: status < 400,
          });
          resolve({
            ok: status < 400,
            ms,
            model,
            httpStatus: status,
            error,
          });
        });
      },
    );
    req.on("error", (err) => {
      const ms = performance.now() - t0;
      logOpenAiHttp({
        kind: "luna_warmup",
        model,
        path: "/v1/responses",
        status: 0,
        ms,
        error: String(err),
        headers: null,
        ok: false,
      });
      resolve({ ok: false, ms, model, httpStatus: 0, error: String(err) });
    });
    req.write(payload);
    req.end();
  });
}
