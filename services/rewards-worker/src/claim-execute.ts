import { heliusChain, heliusRpc } from "./chain.ts";
import type { ClaimBody } from "./claim-route.ts";
import { createSql, postgresRewardsStore } from "./postgres.ts";
import { submitClaim } from "./run.ts";

export async function executeClaim(
  input: { secret: string; expectedAddress: string; suspended: boolean },
  claim: ClaimBody,
): Promise<{ ok: true; signature: string } | { ok: false; code: string }> {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl || !rpcUrl) return { ok: false, code: "inactive" };
  const store = postgresRewardsStore(createSql(databaseUrl));
  const chain = heliusChain((method, params) => heliusRpc(rpcUrl, method, params));
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
