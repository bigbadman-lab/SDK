import "server-only";

const PUBLIC_WORKER = "https://sdk-rewards-worker.onrender.com";

export async function readRewardsRuntime(): Promise<"ready" | "suspended" | "unknown"> {
  const configured = process.env.REWARDS_WORKER_URL?.trim() || PUBLIC_WORKER;
  try {
    const response = await fetch(new URL("/health", configured), { cache: "no-store" });
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { runtime?: unknown; executionAuthorised?: unknown };
    if (body.runtime === "suspended" || body.executionAuthorised === false) return "suspended";
    if (body.runtime === "ready" && body.executionAuthorised === true) return "ready";
    return "unknown";
  } catch {
    return "unknown";
  }
}

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
}): Promise<{ execution: "unavailable" | "confirmed" | "uncertain" | "failed"; signature: string | null; code: string }> {
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
    if (body.code === "failed") return { execution: "failed", signature: typeof body.signature === "string" ? body.signature : null, code: "failed" };
    if (body.code === "uncertain" || body.code === "unreconciled") {
      return { execution: "uncertain", signature: typeof body.signature === "string" ? body.signature : null, code: body.code };
    }
    return { execution: "unavailable", signature: null, code: body.code ?? "failed" };
  } catch {
    return { execution: "unavailable", signature: null, code: "unavailable" };
  }
}
