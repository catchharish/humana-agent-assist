import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";

/** Vercel serverless is read-only under /var/task; keep local runs/ for tests. */
export function writableRoot(): string {
  return process.env.VERCEL ? "/tmp" : process.cwd();
}

export type LogRecord = Record<string, unknown> & { t?: string; kind?: string };

/** Session ids are minted with randomUUID; refuse anything that could walk the path. */
export function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(sessionId);
}

/** Read this call's run log back. Returns [] when the run has written nothing yet. */
export function readJsonl(sessionId: string): LogRecord[] {
  if (!isSafeSessionId(sessionId)) return [];
  const file = path.join(writableRoot(), "runs", `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  const out: LogRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LogRecord);
    } catch {
      /* A torn final line during an in-flight append is not an error. */
    }
  }
  return out;
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
