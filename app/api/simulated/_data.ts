import { readFileSync } from "fs";
import path from "path";

export function readFixture<T>(relativePath: string): T {
  const full = path.join(process.cwd(), "fixtures", relativePath);
  return JSON.parse(readFileSync(full, "utf8")) as T;
}

export function envelope<T>(sourceSystem: string, data: T) {
  return {
    simulated: true as const,
    sourceSystem,
    asOf: new Date().toISOString(),
    data,
  };
}

export async function applyDemoHeaders(request: Request) {
  const delay = Number(request.headers.get("x-demo-delay-ms") || 0);
  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
  }
  return {
    overlay: request.headers.get("x-demo-overlay"),
    forceStatus: request.headers.get("x-demo-force-status"),
  };
}

