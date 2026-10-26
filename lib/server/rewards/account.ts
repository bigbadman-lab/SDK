import "server-only";

import { randomBytes } from "node:crypto";

import { boundClaimMessage, verifyClaimOwnership } from "@/lib/rewards/ownership.ts";
import { rewardsView, type AccountRewardsView, type CreatorEarning } from "@/lib/rewards/account-view.ts";
import { holderThreshold } from "@/lib/rewards/holders.ts";
import type { RewardScope } from "@/lib/rewards/ledger.ts";
import { databaseFailure, getSql } from "@/lib/server/db.ts";
import { readRewardsRuntime, requestClaimExecution } from "@/lib/server/rewards/worker.ts";

const UNAVAILABLE = "The rewards worker did not broadcast the claim.";
const CHILD_SYMBOL = /^[A-Za-z0-9]{1,13}$/;

type CreatorReceiptRow = {
  role: "launcher" | "developer" | "platform";
  scope: RewardScope;
  mint: string;
  amount: string;
  signature: string | null;
  receivedAt: Date | string | null;
  childMint: string | null;
  quoteSymbol: "SDK" | "TREST" | null;
  quoteDecimals: number | string | null;
  childSymbol: string | null;
};

function quoteDecimals(value: number | string | null): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > 9) return null;
  return parsed;
}

function creatorReceipts(rows: readonly CreatorReceiptRow[]): CreatorEarning[] {
  return rows.flatMap((row) => {
    if (row.role !== "launcher" && row.role !== "developer") return [];
    const received = row.receivedAt ? new Date(row.receivedAt) : null;
    return [{
      role: row.role,
      scope: row.scope,
      mint: row.mint,
      amount: row.amount,
      signature: row.signature,
      childMint: row.childMint,
      quoteSymbol: row.quoteSymbol === "SDK" || row.quoteSymbol === "TREST" ? row.quoteSymbol : null,
      quoteDecimals: quoteDecimals(row.quoteDecimals),
      childSymbol: row.childSymbol && CHILD_SYMBOL.test(row.childSymbol) ? row.childSymbol : null,
      receivedAt: received && !Number.isNaN(received.getTime()) ? received.toISOString() : null,
    }];
  });
}

export function rewardScope(value: string | null): RewardScope {
  return value === "test" ? "test" : "production";
}

export async function loadAccountRewards(wallet: string, scope: RewardScope): Promise<AccountRewardsView> {
  const empty = rewardsView({
    scope,
    symbol: null,
    ledger: "missing",
    worker: "unknown",
    snapshots: [],
    claims: [],
    windows: [],
    wallet,
    threshold: null,
    currentBalance: null,
    earnings: [],
  });
  try {
    const sql = getSql();
    const earningsQuery = sql<CreatorReceiptRow[]>`
      select
        receipt.role,
        distribution.scope,
        receipt.quote_mint_address as mint,
        receipt.amount,
        receipt.signature,
        receipt.created_at as "receivedAt",
        distribution.child_mint_address as "childMint",
        parent.symbol as "quoteSymbol",
        parent.decimals as "quoteDecimals",
        (
          select launch.token_symbol
          from launch_submissions submission
          join token_launches launch on launch.id = submission.launch_id
          where submission.child_mint_address = distribution.child_mint_address
            and submission.parent_mint_address = receipt.quote_mint_address
            and submission.scope = distribution.scope
            and submission.status in ('verified', 'page_ready')
            and submission.slot is not null
            and submission.verified_at is not null
            and launch.attempt_status in ('verified', 'page_ready')
          order by submission.verified_at desc
          limit 1
        ) as "childSymbol"
      from child_fee_receipts receipt
      join child_fee_distributions distribution on distribution.id = receipt.distribution_id
      left join parent_registrations parent
        on parent.mint_address = receipt.quote_mint_address
       and parent.scope = distribution.scope
       and parent.eligible = true
       and (
         (distribution.scope = 'test' and parent.symbol = 'TREST')
         or (distribution.scope = 'production' and parent.symbol = 'SDK')
       )
      where receipt.recipient_address = ${wallet} and distribution.scope = ${scope}
      order by receipt.created_at desc
      limit 20
    `.then(
      (rows) => rows,
      (error: unknown) => {
        if (databaseFailure(error) !== "missing_schema") throw error;
        return [];
      },
    );
    const [parents, snapshots, claims, windows, earnings, worker] = await Promise.all([
      sql<{ symbol: "SDK" | "TREST"; decimals: number }[]>`
        select symbol, decimals from parent_registrations where scope = ${scope} limit 1
      `,
      sql<{ owner: string; balance: string; sol_lamports: string; token_amount: string; window_start: Date }[]>`
        select owner_address as owner, balance, sol_lamports::text, token_amount, window_start
        from reward_snapshots
        where scope = ${scope} and owner_address = ${wallet}
      `,
      sql<{ asset: "sol" | "parent_token"; amount: string; status: string; signature: string | null }[]>`
        select liability.asset, liability.amount, claim.status, claim.signature
        from reward_claims claim
        join reward_liabilities liability on liability.id = claim.liability_id
        where claim.scope = ${scope} and claim.claimant = ${wallet}
      `,
      sql<{ window_start: Date }[]>`
        select window_start from reward_windows where scope = ${scope} order by window_start desc limit 1
      `,
      earningsQuery,
      readRewardsRuntime(),
    ]);
    const parent = parents[0] ?? null;
    return rewardsView({
      scope,
      symbol: parent?.symbol ?? null,
      ledger: "ready",
      worker,
      snapshots: snapshots.map((row) => ({
        owner: row.owner,
        balance: row.balance,
        solLamports: row.sol_lamports,
        tokenAmount: row.token_amount,
        windowKey: new Date(row.window_start).toISOString(),
      })),
      claims: claims.map((claim) => ({
        asset: claim.asset === "parent_token" ? "trest" : "sol",
        amount: claim.amount,
        status: claim.status,
        signature: claim.signature,
      })),
      windows: windows.map((row) => ({ windowKey: new Date(row.window_start).toISOString() })),
      wallet,
      threshold: parent ? holderThreshold(parent.decimals) : null,
      currentBalance: null,
      earnings: creatorReceipts(earnings),
    });
  } catch (error) {
    if (databaseFailure(error) === "missing_schema") return empty;
    return { ...empty, executionReason: "Rewards could not be read." };
  }
}

export async function prepareRewardClaim(input: {
  wallet: string;
  scope: RewardScope;
  asset: "sol" | "parent_token";
  domain: string;
}): Promise<{ ok: true; message: string; nonce: string; expiresAt: number; execution: "unavailable" } | { ok: false; code: "amount" | "not_ready" | "parent" }> {
  const view = await loadAccountRewards(input.wallet, input.scope);
  if (view.ledger === "missing") return { ok: false, code: "not_ready" };
  if (!view.symbol) return { ok: false, code: "parent" };
  const amount = input.asset === "sol" ? view.claimableSol : view.claimableToken;
  if (amount === "0") return { ok: false, code: "amount" };
  try {
    const sql = getSql();
    const parents = await sql<{ mint_address: string }[]>`
      select mint_address from parent_registrations where scope = ${input.scope} limit 1
    `;
    const parentMint = parents[0]?.mint_address;
    if (!parentMint) return { ok: false, code: "parent" };
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const message = boundClaimMessage({
      domain: input.domain,
      scope: input.scope,
      parentMint,
      claimant: input.wallet,
      asset: input.asset === "sol" ? "sol" : "trest",
      idempotencyKey: nonce,
      amount,
      nonce,
      expiresAt,
    });
    if (!message) return { ok: false, code: "parent" };
    await sql`
      insert into reward_claim_challenges (
        wallet_address, parent_mint_address, scope, asset, nonce, amount, domain, expires_at
      ) values (
        ${input.wallet}, ${parentMint}, ${input.scope}, ${input.asset}, ${nonce}, ${amount}, ${input.domain}, ${new Date(expiresAt).toISOString()}
      )
    `;
    return { ok: true, message, nonce, expiresAt, execution: "unavailable" };
  } catch (error) {
    if (databaseFailure(error) === "missing_schema") return { ok: false, code: "not_ready" };
    return { ok: false, code: "not_ready" };
  }
}

export async function acceptRewardClaim(input: {
  wallet: string;
  scope: RewardScope;
  nonce: string;
  message: string;
  signature: string;
  domain: string;
}): Promise<
  | { ok: true; execution: "unavailable" | "confirmed" | "uncertain" | "failed"; reason: string; signature: string | null }
  | { ok: false; code: "ownership" | "not_ready" | "expired" }
> {
  const proof = verifyClaimOwnership({ message: input.message, signature: input.signature, claimant: input.wallet });
  if (!proof.ok) return proof;
  try {
    const sql = getSql();
    const rows = await sql<{ domain: string; expires_at: Date; amount: string; parent_mint_address: string; asset: "sol" | "parent_token"; scope: "production" | "test" }[]>`
      select domain, expires_at, amount, parent_mint_address, asset, scope
      from reward_claim_challenges
      where wallet_address = ${input.wallet}
        and scope = ${input.scope}
        and nonce = ${input.nonce}
        and signature is null
        and consumed_at is null
      limit 1
    `;
    const row = rows[0];
    if (!row || row.domain !== input.domain) return { ok: false, code: "ownership" };
    if (Date.now() >= new Date(row.expires_at).getTime()) return { ok: false, code: "expired" };
    if (!input.message.includes(`/${row.amount}\n`) || !input.message.includes(`Domain: ${input.domain}`)) {
      return { ok: false, code: "ownership" };
    }
    await sql`
      update reward_claim_challenges
      set signature = ${input.signature}
      where wallet_address = ${input.wallet} and scope = ${input.scope} and nonce = ${input.nonce} and signature is null
    `;
    const execution = await requestClaimExecution({
      scope: row.scope,
      parentMint: row.parent_mint_address,
      claimant: input.wallet,
      asset: row.asset === "sol" ? "sol" : "trest",
      amount: row.amount,
      idempotencyKey: input.nonce,
      message: input.message,
      signature: input.signature,
      domain: input.domain,
    });
    if (execution.execution === "confirmed" || execution.code === "failed" || execution.code === "duplicate") {
      await sql`update reward_claim_challenges set consumed_at = now() where nonce = ${input.nonce} and consumed_at is null`;
    }
    return {
      ok: true,
      execution: execution.execution,
      reason: execution.execution === "confirmed"
        ? "The payout was confirmed."
        : execution.execution === "uncertain"
          ? "The payout is awaiting reconciliation."
          : execution.execution === "failed"
            ? "The claim failed. No confirmed transfer is recorded."
            : UNAVAILABLE,
      signature: execution.signature,
    };
  } catch (error) {
    if (databaseFailure(error) === "missing_schema") return { ok: false, code: "not_ready" };
    return { ok: false, code: "not_ready" };
  }
}
