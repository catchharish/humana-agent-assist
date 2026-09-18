import { appendFileSync, mkdirSync } from "fs";
import path from "path";

export function appendJsonl(sessionId: string, record: Record<string, unknown>) {
  const dir = path.join(process.cwd(), "runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  appendFileSync(
    file,
    JSON.stringify({ t: new Date().toISOString(), ...record }) + "\n",
  );
}
