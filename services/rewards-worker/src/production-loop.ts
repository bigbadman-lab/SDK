import { canonicalAddress } from "../../../lib/auth/solana.ts";
import { boundClaimMessage } from "../../../lib/rewards/ownership.ts";
import { presentProductionStatus, resolveProductionParent } from "../../../lib/rewards/production.ts";
import { nextUtcWindowDelay } from "../../../lib/rewards/schedule.ts";
import { heliusChain, heliusRpc } from "./chain.ts";
import { beginTick, endTick, instanceHolder, shutdownRequested } from "./lifecycle.ts";
import { authorisedTick } from "./loop.ts";
import { createSql, postgresRewardsStore } from "./postgres.ts";
import { runProductionChildPass } from "./production-child-fees.ts";
import { loadProductionParent, readChildFeeReconciliation, readProductionFlags, readProductionOperations, readRewardsActive } from "./production-scope.ts";
import { replaceProductionStatus } from "./production-status.ts";
import { runProductionCycle, submitClaim } from "./run.ts";

type Sql = ReturnType<typeof createSql>;

async function drainProductionClaims(input: {
  sql: Sql;
  mint: string;
  suspended: boolean;
  secret: string;
  expectedAddress: string;
  store: ReturnType<typeof postgresRewardsStore>;
  chain: ReturnType<typeof heliusChain>;
}): Promise<void> {
  const challenges = await input.sql<
    {
      wallet_address: string;
      parent_mint_address: string;
      scope: "production" | "test";
      asset: "sol" | "parent_token";
      amount: string;
      nonce: string;
      domain: string;
      signature: string;
      expires_at: Date | string;
    }[]
  >`
    select wallet_address, parent_mint_address, scope, asset, amount, nonce, domain, signature, expires_at
    from reward_claim_challenges
    where signature is not null
      and consumed_at is null
      and expires_at > now()
      and scope = 'production'
      and parent_mint_address = ${input.mint}
  `.catch(() => []);
  for (const challenge of challenges) {
    if (shutdownRequested()) return;
    if (challenge.scope !== "production" || canonicalAddress(challenge.parent_mint_address) !== input.mint) continue;
    const expiresAt = new Date(challenge.expires_at).getTime();
    const asset = challenge.asset === "sol" ? "sol" : "trest";
    const message = boundClaimMessage({
      domain: challenge.domain,
      scope: "production",
      parentMint: challenge.parent_mint_address,
      claimant: challenge.wallet_address,
      asset,
      idempotencyKey: challenge.nonce,
      amount: challenge.amount,
      nonce: challenge.nonce,
      expiresAt,
    });
    if (!message) continue;
    const result = await submitClaim({
      loopEnabled: true,
      authorised: true,
      suspended: input.suspended,
      secret: input.secret,
      expectedAddress: input.expectedAddress,
      scope: "production",
      parentMint: challenge.parent_mint_address,
      claimant: challenge.wallet_address,
      asset,
      amount: challenge.amount,
      idempotencyKey: challenge.nonce,
      message,
      signature: challenge.signature,
      domain: challenge.domain,
      nowMs: Date.now(),
      rewardsActive: true,
      admitNewSubmission: () => readRewardsActive(input.sql),
      store: input.store,
      chain: input.chain,
    });
    if (result.ok || result.code === "duplicate" || result.code === "failed" || result.code === "ownership" || result.code === "amount") {
      await input.sql`update reward_claim_challenges set consumed_at = now() where nonce = ${challenge.nonce} and consumed_at is null`;
    }
  }
}

export function startProductionLoop(input: { secret: string; expectedAddress: string; suspended: boolean }): { stop: () => void } {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  if (!databaseUrl || !rpcUrl) {
    console.error("rewards-worker inactive");
    return { stop };
  }
  const sql = createSql(databaseUrl);
  const store = postgresRewardsStore(sql);
  const chain = heliusChain((method, params) => heliusRpc(rpcUrl, method, params), rpcUrl);
  const holder = instanceHolder();
  const run = (): void => {
    if (stopped || shutdownRequested() || !beginTick()) return;
    const suspended = input.suspended || process.env.SDK_SIGNER_SUSPENDED === "true";
    const emergencyFence = process.env.EMERGENCY_FENCE === "true";
    void (async () => {
      const loaded = await loadProductionParent(sql);
      const resolved = resolveProductionParent({
        registration: loaded.registration,
        config: loaded.config,
        signerAddress: input.expectedAddress,
      });
      const stopping = shutdownRequested();
      const rewardsActive = resolved.ok && resolved.rewardsActive && !suspended && !stopping;
      const ops = resolved.ok
        ? await readProductionOperations(sql, resolved.mint)
        : { lastWindow: null, reconciliation: "unknown" as const };
      const flags = await readProductionFlags(sql);
      const childFeeReconciliation = resolved.ok
        ? await readChildFeeReconciliation(sql, resolved.mint)
        : "unknown" as const;
      const executionAuthorised = process.env.REWARDS_LOOP_ENABLED === "true" && process.env.REWARDS_EXECUTION_AUTHORIZED === "true";
      replaceProductionStatus(presentProductionStatus({
        canonicalMint: resolved.ok ? resolved.mint : null,
        signer: suspended ? "suspended" : "matched",
        rewardsActive: resolved.ok && resolved.rewardsActive,
        loopRunning: !stopped && !stopping,
        broadcastsEnabled: rewardsActive,
        lastWindow: ops.lastWindow,
        reconciliation: ops.reconciliation,
        claimsReady: rewardsActive,
        childFeesEnabled: flags.childFeesActive && executionAuthorised && !suspended && !stopping && !emergencyFence && resolved.ok,
        launchesActive: flags.launchesActive && resolved.ok,
        childFeeReconciliation,
        emergencyFence,
      }));
      await authorisedTick({
        suspended,
        emergencyFence,
        cycle: () => runProductionCycle({
          nowMs: Date.now(),
          holder,
          loopEnabled: true,
          authorised: true,
          suspended,
          secret: input.secret,
          expectedAddress: input.expectedAddress,
          shuttingDown: stopping,
          parent: loaded.parent,
          config: loaded.config,
          store,
          chain,
          admitNewSubmission: () => readRewardsActive(sql),
        }),
        claims: async () => {
          if (!resolved.ok) return;
          await drainProductionClaims({
            sql,
            mint: resolved.mint,
            suspended,
            secret: input.secret,
            expectedAddress: input.expectedAddress,
            store,
            chain,
          });
        },
        children: async () => {
          if (!resolved.ok) return;
          await runProductionChildPass({
            sql,
            rpcUrl,
            chain,
            secret: input.secret,
            expectedAddress: input.expectedAddress,
            suspended,
            emergencyFence,
            shuttingDown: stopping,
            canonicalMint: resolved.mint,
            childFeesActive: flags.childFeesActive,
            launchesActive: flags.launchesActive,
            rewardsActive: resolved.rewardsActive,
            executionAuthorised,
          });
        },
      });
    })().catch(() => {
      console.error("rewards-worker cycle");
    }).finally(() => endTick());
  };
  const arm = (): void => {
    if (stopped || shutdownRequested()) return;
    timer = setTimeout(() => {
      run();
      arm();
    }, nextUtcWindowDelay(Date.now()));
  };
  run();
  arm();
  return { stop };
}
