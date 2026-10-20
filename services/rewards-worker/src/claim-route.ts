export type ClaimBody = {
  scope: "test" | "production";
  parentMint: string;
  claimant: string;
  asset: "sol" | "trest";
  amount: string;
  idempotencyKey: string;
  message: string;
  signature: string;
  domain: string;
};

export function parseClaimBody(raw: string): { ok: true; claim: ClaimBody } | { ok: false; code: "invalid" } {
  if (raw.length === 0 || raw.length > 4_000 || raw.includes("\"instructions\"") || raw.includes("\"transaction\"")) {
    return { ok: false, code: "invalid" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid" };
  }
  if (typeof value !== "object" || value === null) return { ok: false, code: "invalid" };
  const body = value as Record<string, unknown>;
  const asset = body.asset === "sol" || body.asset === "trest" ? body.asset : null;
  const scope = body.scope === "test" || body.scope === "production" ? body.scope : null;
  if (!asset || !scope) return { ok: false, code: "invalid" };
  const fields = ["parentMint", "claimant", "amount", "idempotencyKey", "message", "signature", "domain"] as const;
  const claim: Record<string, string> = {};
  for (const field of fields) {
    if (typeof body[field] !== "string" || body[field].length === 0) return { ok: false, code: "invalid" };
    claim[field] = body[field];
  }
  return { ok: true, claim: { ...claim, asset, scope } as ClaimBody };
}

export async function settleClaimHttp(input: {
  headerMatches: boolean;
  runtimeReady: boolean;
  raw: string;
  execute: (claim: ClaimBody) => Promise<{ ok: boolean; code?: string; signature?: string }>;
}): Promise<{ status: number; body: { ok: boolean; code?: string; signature?: string; execution?: string; accept?: boolean } }> {
  const decision = claimsRouteDecision({ headerMatches: input.headerMatches, runtimeReady: input.runtimeReady });
  if (!decision.accept || !input.runtimeReady) {
    return {
      status: decision.accept ? 503 : decision.status,
      body: decision.accept ? { ok: false, code: "inactive" } : decision.body,
    };
  }
  const parsed = parseClaimBody(input.raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, code: "invalid" } };
  const result = await input.execute(parsed.claim);
  if (!result.ok || !result.signature) {
    const code = result.code ?? "inactive";
    const status = code === "inactive" || code === "suspended" ? 503 : 409;
    return { status, body: { ok: false, code } };
  }
  return { status: 200, body: { ok: true, signature: result.signature, execution: "confirmed" } };
}

export function claimsRouteDecision(input: { headerMatches: boolean; runtimeReady: boolean }): {
  status: number;
  accept: boolean;
  body: { ok: false; code: "unauthorised" | "inactive" } | { ok: true; accept: true };
} {
  if (!input.headerMatches) return { status: 401, accept: false, body: { ok: false, code: "unauthorised" } };
  if (!input.runtimeReady) return { status: 503, accept: false, body: { ok: false, code: "inactive" } };
  return { status: 200, accept: true, body: { ok: true, accept: true } };
}
