/**
 * Session-bound quote GET. Same function for code-on-consent and the model getQuotes tool.
 */
export async function fetchMemberQuotes(args: {
  origin: string;
  authId: string;
  memberId: string;
  pharmacyId?: string;
  overlay?: string | null;
}): Promise<{
  json: unknown;
  quotes: Array<Record<string, unknown>>;
  ms: number;
  status: number;
}> {
  const t0 = performance.now();
  const q = new URLSearchParams({ memberId: args.memberId });
  if (args.pharmacyId) q.set("pharmacyId", args.pharmacyId);
  const headers: Record<string, string> = {
    "x-authorization-id": args.authId,
  };
  if (args.overlay) headers["x-demo-overlay"] = args.overlay;
  const res = await fetch(
    `${args.origin}/api/simulated/pharmacy/quotes?${q.toString()}`,
    { cache: "no-store", headers },
  );
  const text = await res.text();
  let json: { data?: { quotes?: Array<Record<string, unknown>> } };
  try {
    json = JSON.parse(text) as { data?: { quotes?: Array<Record<string, unknown>> } };
  } catch {
    json = {};
  }
  return {
    json,
    quotes: json.data?.quotes ?? [],
    ms: performance.now() - t0,
    status: res.status,
  };
}
