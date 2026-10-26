import { claimScopeAllowed, resolveProductionParent } from "../../../lib/rewards/production.ts";
import { heliusChain, heliusRpc } from "./chain.ts";
import type { ClaimBody } from "./claim-route.ts";
import { shutdownRequested } from "./lifecycle.ts";
import { createSql, postgresRewardsStore } from "./postgres.ts";
import { loadProductionParent } from "./production-scope.ts";
import { submitClaim } from "./run.ts";
import { loadVerifiedTrestParent, trestClaimAllowed } from "./trest-scope.ts";

export async function executeClaim(
  input: { secret: string; expectedAddress: string; suspended: boolean; mode?: "test" | "production" },
  claim: ClaimBody,
): Promise<{ ok: true; signature: string } | { ok: false; code: string }> {
  const mode = input.mode ?? "test";
  if (shutdownRequested()) return { ok: false, code: "inactive" };
  if (!claimScopeAllowed(mode, claim.scope)) return { ok: false, code: "parent" };
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl || !rpcUrl) return { ok: false, code: "inactive" };
  const sql = createSql(databaseUrl);
  const store = postgresRewardsStore(sql);
  const chain = heliusChain((method, params) => heliusRpc(rpcUrl, method, params), rpcUrl);
  if (mode === "production") {
    const suspended = input.suspended || process.env.SDK_SIGNER_SUSPENDED === "true";
    if (suspended) return { ok: false, code: "inactive" };
    const loaded = await loadProductionParent(sql);
    const resolved = resolveProductionParent({
      registration: loaded.registration,
      config: loaded.config,
      signerAddress: input.expectedAddress,
    });
    if (!resolved.ok || claim.parentMint !== resolved.mint) return { ok: false, code: "parent" };
    if (!resolved.rewardsActive) return { ok: false, code: "inactive" };
    const result = await submitClaim({
      loopEnabled: true,
      authorised: true,
      suspended,
      secret: input.secret,
      expectedAddress: input.expectedAddress,
      scope: "production",
      parentMint: claim.parentMint,
      claimant: claim.claimant,
      asset: claim.asset,
      amount: claim.amount,
      idempotencyKey: claim.idempotencyKey,
      message: claim.message,
      signature: claim.signature,
      domain: claim.domain,
      nowMs: Date.now(),
      rewardsActive: true,
      store,
      chain,
    });
    return result.ok ? result : { ok: false, code: result.code };
  }
  const parent = await loadVerifiedTrestParent(sql, input.expectedAddress);
  if (!trestClaimAllowed(parent, claim)) return { ok: false, code: "parent" };
  const result = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: input.suspended || process.env.TREST_SIGNER_SUSPENDED === "true",
    secret: input.secret,
    expectedAddress: input.expectedAddress,
    scope: claim.scope,
    parentMint: claim.parentMint,
    claimant: claim.claimant,
    asset: claim.asset,
    amount: claim.amount,
    idempotencyKey: claim.idempotencyKey,
    message: claim.message,
    signature: claim.signature,
    domain: claim.domain,
    nowMs: Date.now(),
    store,
    chain,
  });
  return result.ok ? result : { ok: false, code: result.code };
}
