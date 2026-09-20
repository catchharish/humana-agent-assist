import { appendFileSync, mkdirSync } from "fs";
import path from "path";

/** Vercel serverless is read-only under /var/task; keep local runs/ for tests. */
export function writableRoot(): string {
  return process.env.VERCEL ? "/tmp" : process.cwd();
}

export function appendJsonl(sessionId: string, record: Record<string, unknown>) {
  const dir = path.join(writableRoot(), "runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  appendFileSync(
    file,
    JSON.stringify({ t: new Date().toISOString(), ...record }) + "\n",
  );
}

/** Process-wide OpenAI HTTP log (luna, terra, embeddings, warmups). No secrets. */
export function appendOpenAiHttp(record: Record<string, unknown>) {
  const dir = path.join(writableRoot(), "runs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    path.join(dir, "openai_http.jsonl"),
    JSON.stringify({ t: new Date().toISOString(), ...record }) + "\n",
  );
}
