import { readFileSync } from "fs";
import http from "http";
import https from "https";
import path from "path";

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function readKey(): string {
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

export async function warmupLuna(): Promise<{
  ok: boolean;
  ms: number;
  model: string;
}> {
  const key = readKey();
  const model = process.env.OPENAI_FAST_MODEL || "gpt-5.6-luna";
  if (!key) {
    return { ok: false, ms: 0, model };
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
        res.resume();
        res.on("end", () => {
          resolve({
            ok: (res.statusCode ?? 500) < 400,
            ms: performance.now() - t0,
            model,
          });
        });
      },
    );
    req.on("error", () => {
      resolve({ ok: false, ms: performance.now() - t0, model });
    });
    req.write(payload);
    req.end();
  });
}
