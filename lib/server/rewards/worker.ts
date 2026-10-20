import "server-only";

export async function requestClaimExecution(claim: {
  scope: "test" | "production";
  parentMint: string;
  claimant: string;
  asset: "sol" | "trest";
  amount: string;
  idempotencyKey: string;
  message: string;
  signature: string;
  domain: string;
}): Promise<{ execution: "unavailable" | "confirmed" | "uncertain"; signature: string | null; code: string }> {
  const url = process.env.REWARDS_WORKER_URL?.trim() ?? "";
  const secret = process.env.REWARDS_WORKER_SECRET?.trim() ?? "";
  if (!url || !secret) return { execution: "unavailable", signature: null, code: "unavailable" };
  try {
    const response = await fetch(new URL("/v1/claims", url), {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-sdk-worker-auth": secret },
      body: JSON.stringify(claim),
    });
    const body = (await response.json()) as { ok?: boolean; code?: string; signature?: string };
    if (response.status === 503 || body.code === "inactive" || body.code === "suspended") {
      return { execution: "unavailable", signature: null, code: body.code ?? "unavailable" };
    }
    if (body.ok && typeof body.signature === "string") return { execution: "confirmed", signature: body.signature, code: "confirmed" };
    if (body.code === "uncertain" || body.code === "unreconciled") {
      return { execution: "uncertain", signature: typeof body.signature === "string" ? body.signature : null, code: body.code };
    }
    return { execution: "unavailable", signature: null, code: body.code ?? "failed" };
  } catch {
    return { execution: "unavailable", signature: null, code: "unavailable" };
  }
}
