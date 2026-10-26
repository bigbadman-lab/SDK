import { accountingWindow } from "../../../lib/rewards/ledger.ts";
import { matchShareholderReceipts } from "../../../lib/rewards/child-fees.ts";
import { inspectRewardsTransaction, signedTransactionWire } from "../../../lib/rewards/inspect.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import {
  CHILD_FEE_BATCH,
  acceptProductionChild,
  broadcastPersistedChildIntent,
  persistedChildIntent,
  productionChildBatch,
  productionChildFeeControl,
  receiptRole,
  signedChildIntentBlocksRetry,
  type ProductionChildRow,
} from "../../../lib/rewards/child-fee-gate.ts";
import { serviceChildFees, type ChildCandidate } from "./child-fees.ts";
import { buildDistribution, readChildFeeVault, readQuoteDeltas, readSharing } from "./child-distribution.ts";
import { shutdownRequested } from "./lifecycle.ts";
import { createSql } from "./postgres.ts";
import type { Chain } from "./chain.ts";

type Sql = ReturnType<typeof createSql>;

const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

export async function discoverProductionChildren(sql: Sql, canonicalMint: string): Promise<ChildCandidate[]> {
  try {
    const rows = await sql<ProductionChildRow[]>`
      select s.child_mint_address as mint,
             s.parent_mint_address as "quoteMint",
             b.parent_mint_address as "buildQuote",
             s.scope as scope,
             l.fee_category as category,
             l.wallet_address as launcher,
             o.wallet_address as originator,
             l.attempt_status as "attemptStatus",
             s.status as "submissionStatus"
      from launch_submissions s
      join token_launches l on l.id = s.launch_id
      join launch_builds b on b.id = s.build_id
      left join accounts o on o.id = l.originator_account_id
      where l.parent_scope = 'production'
        and l.parent_mint_address is null
        and l.attempt_status in ('verified', 'page_ready')
        and l.attempt_mint_address = s.child_mint_address
        and s.scope = 'production'
        and s.status in ('verified', 'page_ready')
        and s.parent_mint_address = ${canonicalMint}
        and b.parent_mint_address = ${canonicalMint}
      order by s.verified_at asc nulls last, s.child_mint_address asc
      limit 32
    `;
    return rows.flatMap((row) => {
      const accepted = acceptProductionChild(row, canonicalMint);
      return accepted ? [accepted] : [];
    });
  } catch {
    return [];
  }
}

async function completedKeys(sql: Sql): Promise<string[]> {
  const rows = await sql<{ idempotency_key: string }[]>`
    select idempotency_key from child_fee_distributions
    where status in ('submitted', 'confirmed', 'uncertain', 'unreconciled')
  `;
  return rows.map((row) => row.idempotency_key);
}

async function recordReceipts(sql: Sql, input: {
  distributionId: string;
  quoteMint: string;
  signature: string;
  slot: string | null;
  launcher: string;
  originator: string | null;
  receipts: readonly { address: string; amount: string }[];
}): Promise<void> {
  for (const receipt of input.receipts) {
    const role = receiptRole({ address: receipt.address, launcher: input.launcher, originator: input.originator });
    if (!role) continue;
    await sql`
      insert into child_fee_receipts (
        distribution_id, recipient_address, quote_mint_address, amount, role, signature, slot
      ) values (
        ${input.distributionId}::uuid, ${receipt.address}, ${input.quoteMint}, ${receipt.amount}, ${role}, ${input.signature}, ${input.slot}
      )
      on conflict (distribution_id, recipient_address) do nothing
    `;
  }
}

async function findProductionChild(sql: Sql, canonicalMint: string, childMint: string): Promise<ChildCandidate | null> {
  const rows = await sql<ProductionChildRow[]>`
    select s.child_mint_address as mint,
           s.parent_mint_address as "quoteMint",
           b.parent_mint_address as "buildQuote",
           s.scope as scope,
           l.fee_category as category,
           l.wallet_address as launcher,
           o.wallet_address as originator,
           l.attempt_status as "attemptStatus",
           s.status as "submissionStatus"
    from launch_submissions s
    join token_launches l on l.id = s.launch_id
    join launch_builds b on b.id = s.build_id
    left join accounts o on o.id = l.originator_account_id
    where s.child_mint_address = ${childMint}
      and l.parent_scope = 'production'
      and l.parent_mint_address is null
      and s.scope = 'production'
      and s.parent_mint_address = ${canonicalMint}
      and b.parent_mint_address = ${canonicalMint}
    limit 1
  `;
  return rows[0] ? acceptProductionChild(rows[0], canonicalMint) : null;
}

export async function reconcileProductionChildFees(input: {
  sql: Sql;
  rpcUrl: string;
  canonicalMint: string;
  children: readonly ChildCandidate[];
}): Promise<number> {
  const open = await input.sql<{
    idempotencyKey: string;
    childMint: string;
    quoteMint: string;
    signature: string;
    scope: string;
  }[]>`
    select idempotency_key as "idempotencyKey",
           child_mint_address as "childMint",
           quote_mint_address as "quoteMint",
           signature,
           scope
    from child_fee_distributions
    where status in ('submitted', 'uncertain', 'unreconciled')
      and signature is not null
      and scope = 'production'
      and quote_mint_address = ${input.canonicalMint}
  `;
  let reconciled = 0;
  for (const row of open) {
    if (shutdownRequested()) return reconciled;
    const listed = input.children.find((candidate) => candidate.mint === row.childMint && candidate.scope === "production");
    const child = listed ?? await findProductionChild(input.sql, input.canonicalMint, row.childMint);
    if (!child || child.quoteMint !== input.canonicalMint || row.scope !== "production") continue;
    try {
      const sharing = await readSharing(input.rpcUrl, child.mint);
      const deltas = await readQuoteDeltas(input.rpcUrl, row.signature, row.quoteMint);
      const credits = (deltas ?? []).filter((delta) => delta.sign === "credit");
      const distributed = credits.reduce((sum, delta) => sum + BigInt(delta.amount), BigInt(0)).toString();
      const matched = sharing && deltas
        ? matchShareholderReceipts({ quoteMint: row.quoteMint, shareholders: sharing.shareholders, distributed, deltas })
        : { ok: false as const, code: "unconfirmed" as const };
      if (!matched.ok) continue;
      const ids = await input.sql<{ id: string }[]>`
        select id from child_fee_distributions where idempotency_key = ${row.idempotencyKey} and scope = 'production'
      `;
      const distributionId = ids[0]?.id;
      if (!distributionId) continue;
      await recordReceipts(input.sql, {
        distributionId,
        quoteMint: row.quoteMint,
        signature: row.signature,
        slot: null,
        launcher: child.launcher,
        originator: child.originator,
        receipts: matched.receipts,
      });
      const updated = await input.sql<{ id: string }[]>`
        update child_fee_distributions
        set status = 'confirmed', amount = ${distributed}
        where idempotency_key = ${row.idempotencyKey}
          and scope = 'production'
          and status in ('submitted', 'uncertain', 'unreconciled')
        returning id
      `;
      if (updated.length === 1) reconciled += 1;
    } catch {
      continue;
    }
  }
  return reconciled;
}

export async function runProductionChildPass(input: {
  sql: Sql;
  rpcUrl: string;
  chain: Chain;
  secret: string;
  expectedAddress: string;
  suspended: boolean;
  emergencyFence: boolean;
  shuttingDown: boolean;
  canonicalMint: string | null;
  childFeesActive: boolean;
  launchesActive: boolean;
  rewardsActive: boolean;
  executionAuthorised: boolean;
}): Promise<{ reconciled: number; submitted: number }> {
  const control = productionChildFeeControl({
    canonicalMint: input.canonicalMint,
    childFeesActive: input.childFeesActive,
    launchesActive: input.launchesActive,
    rewardsActive: input.rewardsActive,
    executionAuthorised: input.executionAuthorised,
    signerMatched: !input.suspended,
    suspended: input.suspended,
    emergencyFence: input.emergencyFence,
    shuttingDown: input.shuttingDown || shutdownRequested(),
  });
  if (!input.canonicalMint || (!control.reconcile && !control.distribute)) return { reconciled: 0, submitted: 0 };
  const children = await discoverProductionChildren(input.sql, input.canonicalMint);
  const reconciled = control.reconcile
    ? await reconcileProductionChildFees({
        sql: input.sql,
        rpcUrl: input.rpcUrl,
        canonicalMint: input.canonicalMint,
        children,
      }).catch(() => 0)
    : 0;
  if (!control.distribute || shutdownRequested()) return { reconciled, submitted: 0 };
  const window = accountingWindow(Date.now());
  if (!window) return { reconciled, submitted: 0 };
  let completed: string[] = [];
  let blockedMints = new Set<string>();
  try {
    await input.sql`
      delete from child_fee_distributions
      where scope = 'production'
        and status = 'recorded'
        and signature is null
        and idempotency_key not like ${`child:production:%:${window.startMs}`}
    `;
    completed = await completedKeys(input.sql);
    const open = await input.sql<{ mint: string; status: string }[]>`
      select child_mint_address as mint, status
      from child_fee_distributions
      where scope = 'production'
        and quote_mint_address = ${input.canonicalMint}
        and signature is not null
        and status in ('submitted', 'uncertain', 'unreconciled')
    `;
    blockedMints = new Set(open.filter((row) => signedChildIntentBlocksRetry(row.status)).map((row) => row.mint));
  } catch {
    return { reconciled, submitted: 0 };
  }
  const batch = productionChildBatch(children.filter((child) => !blockedMints.has(child.mint)), completed, window.startMs, 32);
  let attempts = 0;
  const result = await serviceChildFees({
    nowMs: Date.now(),
    authorised: true,
    suspended: input.suspended,
    emergencyFence: input.emergencyFence,
    children: batch,
    completedKeys: completed,
    readConfig: async (child) => {
      const vault = await readChildFeeVault(input.rpcUrl, child.mint, child.quoteMint);
      if (!vault || vault.quoteMint !== input.canonicalMint || !TOKEN_PROGRAMS.has(vault.tokenProgram)) return null;
      const sharing = await readSharing(input.rpcUrl, child.mint);
      return sharing;
    },
    prepare: async (child) => buildDistribution(input.rpcUrl, child, input.expectedAddress),
    submit: async (child, key, instructions, shareholders) => {
      if (attempts >= CHILD_FEE_BATCH || shutdownRequested() || child.scope !== "production" || child.quoteMint !== input.canonicalMint) {
        return { status: "failed" as const };
      }
      const vault = await readChildFeeVault(input.rpcUrl, child.mint, child.quoteMint);
      if (!vault || vault.quoteMint !== input.canonicalMint || !TOKEN_PROGRAMS.has(vault.tokenProgram)) {
        return { status: "failed" as const };
      }
      const transaction = {
        feePayer: input.expectedAddress,
        recentBlockhash: await input.chain.blockhash(),
        instructions: instructions.map((instruction) => ({
          programId: instruction.programId,
          keys: instruction.keys,
          data: instruction.data,
        })),
      };
      const policy = {
        kind: "child_distribute" as const,
        scope: "production" as const,
        parentMint: input.canonicalMint,
        deployer: input.expectedAddress,
        recipient: input.expectedAddress,
        maxLamports: "0",
        maxRentLamports: "50000000",
        tokenProgram: vault.tokenProgram,
      };
      if (!inspectRewardsTransaction(transaction, policy).ok) return { status: "failed" as const };
      const elsewhere = await input.sql<{ id: string; status: string }[]>`
        select id, status from child_fee_distributions
        where scope = 'production'
          and child_mint_address = ${child.mint}
          and signature is not null
          and status in ('submitted', 'uncertain', 'unreconciled')
          and idempotency_key <> ${key}
      `;
      if (elsewhere.some((row) => signedChildIntentBlocksRetry(row.status))) return { status: "uncertain" as const };
      const gate = await input.sql<{ open: boolean }[]>`
        select child_fees_active as open from sdk_parent_config where id = 1
      `;
      if (gate[0]?.open !== true) return { status: "failed" as const };
      const inserted = await input.sql<{ idempotency_key: string }[]>`
        insert into child_fee_distributions (
          idempotency_key, child_mint_address, quote_mint_address, scope, status, signature
        ) values (
          ${key}, ${child.mint}, ${child.quoteMint}, 'production', 'recorded', null
        )
        on conflict (idempotency_key) do nothing
        returning idempotency_key
      `;
      if (inserted.length === 0) {
        const existing = await input.sql<{ status: string; signature: string | null }[]>`
          select status, signature from child_fee_distributions
          where idempotency_key = ${key} and scope = 'production'
        `;
        if (persistedChildIntent(existing[0] ?? null) !== "claim") return { status: "uncertain" as const };
      }
      if (shutdownRequested()) return { status: "uncertain" as const };
      attempts += 1;
      const signed = signInspected({
        secret: input.secret,
        expectedAddress: input.expectedAddress,
        suspended: input.suspended,
        transaction,
        policy,
      });
      const wire = signed.ok ? signedTransactionWire(transaction, signed.signature) : null;
      if (!signed.ok || !wire) return { status: "uncertain" as const };
      const claimed = await input.sql<{ idempotency_key: string }[]>`
        update child_fee_distributions
        set status = 'submitted', signature = ${signed.signature}
        where idempotency_key = ${key}
          and scope = 'production'
          and status = 'recorded'
          and signature is null
        returning idempotency_key
      `;
      if (!broadcastPersistedChildIntent({ claimed: claimed.length === 1, shuttingDown: shutdownRequested() })) {
        return { status: "uncertain" as const };
      }
      const freshGate = await input.sql<{ open: boolean }[]>`
        select child_fees_active as open from sdk_parent_config where id = 1
      `;
      if (freshGate[0]?.open !== true) {
        await input.sql`
          update child_fee_distributions
          set status = 'uncertain'
          where idempotency_key = ${key} and scope = 'production' and status = 'submitted'
        `;
        return { status: "uncertain" as const };
      }
      let sent: Awaited<ReturnType<Chain["submit"]>>;
      try {
        sent = await input.chain.submit(wire);
      } catch {
        await input.sql`
          update child_fee_distributions
          set status = 'uncertain'
          where idempotency_key = ${key} and scope = 'production' and status = 'submitted'
        `;
        return { status: "uncertain" as const };
      }
      if (sent.status !== "accepted") {
        const status = sent.status === "uncertain" ? "uncertain" : "failed";
        await input.sql`
          update child_fee_distributions
          set status = ${status}
          where idempotency_key = ${key} and scope = 'production' and status = 'submitted'
        `;
        return { status };
      }
      const observed = await input.chain.transaction(signed.signature, {
        creator: input.expectedAddress,
        solVault: input.expectedAddress,
        wsolVault: input.expectedAddress,
        parentMint: child.quoteMint,
        destination: input.expectedAddress,
      });
      if (observed?.status === "failed") {
        await input.sql`
          update child_fee_distributions
          set status = 'failed'
          where idempotency_key = ${key} and scope = 'production' and status = 'submitted'
        `;
        return { status: "failed" as const };
      }
      const deltas = observed?.status === "confirmed" ? await readQuoteDeltas(input.rpcUrl, signed.signature, child.quoteMint) : null;
      const distributed = (deltas ?? []).filter((row) => row.sign === "credit").reduce((sum, row) => sum + BigInt(row.amount), BigInt(0)).toString();
      const matched = deltas
        ? matchShareholderReceipts({ quoteMint: child.quoteMint, shareholders, distributed, deltas })
        : { ok: false as const, code: "unconfirmed" as const };
      if (!matched.ok) {
        await input.sql`
          update child_fee_distributions
          set status = 'unreconciled'
          where idempotency_key = ${key} and scope = 'production' and status = 'submitted'
        `;
        return { status: "unreconciled" as const };
      }
      const rows = await input.sql<{ id: string }[]>`
        select id from child_fee_distributions where idempotency_key = ${key} and scope = 'production'
      `;
      const distributionId = rows[0]?.id;
      if (distributionId) {
        await recordReceipts(input.sql, {
          distributionId,
          quoteMint: child.quoteMint,
          signature: signed.signature,
          slot: observed?.slot ?? null,
          launcher: child.launcher,
          originator: child.originator,
          receipts: matched.receipts,
        });
      }
      await input.sql`
        update child_fee_distributions
        set status = 'confirmed', amount = ${distributed}
        where idempotency_key = ${key} and scope = 'production' and status = 'submitted'
      `;
      return { status: "confirmed" as const, receipts: matched.receipts };
    },
  });
  return { reconciled, submitted: result.ok ? result.submitted : 0 };
}
