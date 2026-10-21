import { canonicalAddress } from "../../../lib/auth/solana.ts";
import { boundClaimMessage } from "../../../lib/rewards/ownership.ts";
import { inspectRewardsTransaction, signedTransactionWire } from "../../../lib/rewards/inspect.ts";
import { nextUtcWindowDelay, ordinaryWorkAllowed } from "../../../lib/rewards/schedule.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { heliusChain, heliusRpc } from "./chain.ts";
import { matchShareholderReceipts } from "../../../lib/rewards/child-fees.ts";
import { serviceChildFees, type ChildCandidate } from "./child-fees.ts";
import { buildDistribution, readQuoteDeltas, readSharing } from "./child-distribution.ts";
import { createSql, postgresRewardsStore } from "./postgres.ts";
import { runCycle, submitClaim } from "./run.ts";
import { loadVerifiedTrestParent, selectTrestChildren, selectTrestClaims, selectTrestOpenIntents } from "./trest-scope.ts";

type Sql = ReturnType<typeof createSql>;

async function discover(sql: Sql, parentMint: string): Promise<ChildCandidate[]> {
  try {
    const rows = await sql<ChildCandidate[]>`
      select l.attempt_mint_address as mint,
             l.parent_mint_address as "quoteMint",
             l.parent_scope as scope,
             l.fee_category as category,
             l.wallet_address as launcher,
             o.wallet_address as originator
      from token_launches l
      left join accounts o on o.id = l.originator_account_id
      where l.attempt_status = 'verified'
        and l.attempt_mint_address is not null
        and l.parent_mint_address = ${parentMint}
        and l.parent_scope = 'test'
    `;
    return rows.filter((row) => row.mint && row.quoteMint && row.scope === "test");
  } catch {
    return [];
  }
}

async function completed(sql: Sql): Promise<string[]> {
  try {
    const rows = await sql<{ idempotency_key: string }[]>`
      select idempotency_key from child_fee_distributions
      where status in ('submitted', 'confirmed', 'uncertain', 'unreconciled')
    `;
    return rows.map((row) => row.idempotency_key);
  } catch {
    return [];
  }
}

export async function authorisedTick(input: {
  suspended: boolean;
  emergencyFence: boolean;
  cycle: () => Promise<unknown>;
  claims: () => Promise<void>;
  children: () => Promise<void>;
}): Promise<{ ordinary: boolean }> {
  await input.cycle();
  if (!ordinaryWorkAllowed({ suspended: input.suspended, emergencyFence: input.emergencyFence })) return { ordinary: false };
  await input.claims();
  await input.children();
  return { ordinary: true };
}

export function startRewardsLoop(input: { secret: string; expectedAddress: string; suspended: boolean }): void {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl || !rpcUrl) {
    console.error("rewards-worker inactive");
    return;
  }
  const sql = createSql(databaseUrl);
  const store = postgresRewardsStore(sql);
  const chain = heliusChain((method, params) => heliusRpc(rpcUrl, method, params), rpcUrl);
  const run = (): void => {
    const suspended = input.suspended || process.env.TREST_SIGNER_SUSPENDED === "true";
    const emergencyFence = process.env.EMERGENCY_FENCE === "true";
    void authorisedTick({
      suspended,
      emergencyFence,
      cycle: () => runCycle({
        nowMs: Date.now(),
        holder: "rewards-worker",
        loopEnabled: true,
        authorised: true,
        suspended,
        secret: input.secret,
        expectedAddress: input.expectedAddress,
        store,
        chain,
      }),
      claims: async () => {
      const parent = await loadVerifiedTrestParent(sql, input.expectedAddress);
      if (!parent.ok) return;
      const challenges = await sql<
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
          and scope = 'test'
          and parent_mint_address = ${parent.mintAddress}
      `.catch(() => []);
      for (const challenge of selectTrestClaims(parent, challenges.map((row) => ({ ...row, parentMint: row.parent_mint_address })))) {
        if (challenge.scope !== "test" || canonicalAddress(challenge.parent_mint_address) !== parent.mintAddress) continue;
        const expiresAt = new Date(challenge.expires_at).getTime();
        const asset = challenge.asset === "sol" ? "sol" : "trest";
        const message = boundClaimMessage({
          domain: challenge.domain,
          scope: challenge.scope,
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
          suspended,
          secret: input.secret,
          expectedAddress: input.expectedAddress,
          scope: challenge.scope,
          parentMint: challenge.parent_mint_address,
          claimant: challenge.wallet_address,
          asset,
          amount: challenge.amount,
          idempotencyKey: challenge.nonce,
          message,
          signature: challenge.signature,
          domain: challenge.domain,
          nowMs: Date.now(),
          store,
          chain,
        });
        if (result.ok || result.code === "duplicate" || result.code === "failed" || result.code === "ownership" || result.code === "amount") {
          await sql`update reward_claim_challenges set consumed_at = now() where nonce = ${challenge.nonce} and consumed_at is null`;
        }
      }
      },
      children: async () => {
      const parent = await loadVerifiedTrestParent(sql, input.expectedAddress);
      if (!parent.ok) return;
      const children = selectTrestChildren(parent, await discover(sql, parent.mintAddress));
      const open = selectTrestOpenIntents(parent, children, await sql<
        { idempotencyKey: string; childMint: string; quoteMint: string; signature: string; scope: "production" | "test" }[]
      >`
        select idempotency_key as "idempotencyKey",
               child_mint_address as "childMint",
               quote_mint_address as "quoteMint",
               signature,
               scope
        from child_fee_distributions
        where status in ('submitted', 'uncertain', 'unreconciled')
          and signature is not null
          and scope = 'test'
          and quote_mint_address = ${parent.mintAddress}
      `.catch(() => []));
      for (const row of open) {
        const child = children.find((candidate) => candidate.mint === row.childMint && candidate.scope === row.scope);
        if (!child || child.scope !== "test") continue;
        const sharing = await readSharing(rpcUrl, child.mint);
        const deltas = await readQuoteDeltas(rpcUrl, row.signature, row.quoteMint);
        const credits = (deltas ?? []).filter((delta) => delta.sign === "credit");
        const distributed = credits.reduce((sum, delta) => sum + BigInt(delta.amount), BigInt(0)).toString();
        const matched = sharing && deltas
          ? matchShareholderReceipts({ quoteMint: row.quoteMint, shareholders: sharing.shareholders, distributed, deltas })
          : { ok: false as const, code: "unconfirmed" as const };
        if (!matched.ok) continue;
        const ids = await sql<{ id: string }[]>`select id from child_fee_distributions where idempotency_key = ${row.idempotencyKey}`;
        const distributionId = ids[0]?.id;
        if (!distributionId) continue;
        for (const receipt of matched.receipts) {
          const role = receipt.address === child.launcher ? "launcher" : receipt.address === child.originator ? "developer" : "platform";
          await sql`
            insert into child_fee_receipts (
              distribution_id, recipient_address, quote_mint_address, amount, role, signature, slot
            ) values (
              ${distributionId}::uuid, ${receipt.address}, ${row.quoteMint}, ${receipt.amount}, ${role}, ${row.signature}, null
            )
            on conflict (distribution_id, recipient_address) do nothing
          `;
        }
        await sql`update child_fee_distributions set status = 'confirmed', amount = ${distributed} where idempotency_key = ${row.idempotencyKey} and status in ('submitted', 'uncertain', 'unreconciled')`;
      }
      await serviceChildFees({
        nowMs: Date.now(),
        authorised: true,
        suspended,
        emergencyFence,
        children,
        completedKeys: await completed(sql),
        readConfig: async (child) => readSharing(rpcUrl, child.mint),
        prepare: async (child) => buildDistribution(rpcUrl, child, input.expectedAddress),
        submit: async (child, key, instructions, shareholders) => {
          if (child.scope !== "test" || canonicalAddress(child.quoteMint) !== parent.mintAddress) return { status: "failed" as const };
          const transaction = {
            feePayer: input.expectedAddress,
            recentBlockhash: await chain.blockhash(),
            instructions: instructions.map((instruction) => ({
              programId: instruction.programId,
              keys: instruction.keys,
              data: instruction.data,
            })),
          };
          const policy = {
            kind: "child_distribute" as const,
            scope: child.scope,
            parentMint: child.quoteMint,
            deployer: input.expectedAddress,
            recipient: input.expectedAddress,
            maxLamports: "0",
            maxRentLamports: "50000000",
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          };
          if (!inspectRewardsTransaction(transaction, policy).ok) return { status: "failed" as const };
          const signed = signInspected({
            secret: input.secret,
            expectedAddress: input.expectedAddress,
            suspended,
            transaction,
            policy,
          });
          if (!signed.ok) return { status: "failed" as const };
          const wire = signedTransactionWire(transaction, signed.signature);
          if (!wire) return { status: "failed" as const };
          const reserved = await sql<{ idempotency_key: string }[]>`
            insert into child_fee_distributions (
              idempotency_key, child_mint_address, quote_mint_address, scope, status, signature
            ) values (
              ${key}, ${child.mint}, ${child.quoteMint}, ${child.scope}, 'submitted', ${signed.signature}
            )
            on conflict (idempotency_key) do nothing
            returning idempotency_key
          `;
          if (reserved.length === 0) return { status: "uncertain" as const };
          const sent = await chain.submit(wire);
          if (sent.status !== "accepted") {
            const status = sent.status === "uncertain" ? "uncertain" : "failed";
            await sql`update child_fee_distributions set status = ${status} where idempotency_key = ${key}`;
            return { status };
          }
          const observed = await chain.transaction(signed.signature, {
            creator: input.expectedAddress,
            solVault: input.expectedAddress,
            wsolVault: input.expectedAddress,
            parentMint: child.quoteMint,
            destination: input.expectedAddress,
          });
          if (observed?.status === "failed") {
            await sql`update child_fee_distributions set status = 'failed' where idempotency_key = ${key}`;
            return { status: "failed" as const };
          }
          const deltas = observed?.status === "confirmed" ? await readQuoteDeltas(rpcUrl, signed.signature, child.quoteMint) : null;
          const distributed = (deltas ?? []).filter((row) => row.sign === "credit").reduce((sum, row) => sum + BigInt(row.amount), BigInt(0)).toString();
          const matched = deltas ? matchShareholderReceipts({ quoteMint: child.quoteMint, shareholders, distributed, deltas }) : { ok: false as const, code: "unconfirmed" as const };
          if (!matched.ok) {
            await sql`update child_fee_distributions set status = 'unreconciled' where idempotency_key = ${key}`;
            return { status: "unreconciled" as const };
          }
          const rows = await sql<{ id: string }[]>`select id from child_fee_distributions where idempotency_key = ${key}`;
          const distributionId = rows[0]?.id;
          if (distributionId) {
            for (const receipt of matched.receipts) {
              const role = receipt.address === child.launcher ? "launcher" : receipt.address === child.originator ? "developer" : "platform";
              await sql`
                insert into child_fee_receipts (
                  distribution_id, recipient_address, quote_mint_address, amount, role, signature, slot
                ) values (
                  ${distributionId}::uuid, ${receipt.address}, ${child.quoteMint}, ${receipt.amount}, ${role}, ${signed.signature}, ${observed?.slot ?? null}
                )
                on conflict (distribution_id, recipient_address) do nothing
              `;
            }
          }
          await sql`update child_fee_distributions set status = 'confirmed', amount = ${distributed} where idempotency_key = ${key}`;
          return { status: "confirmed" as const, receipts: matched.receipts };
        },
      });
      },
    }).catch(() => {
      console.error("rewards-worker cycle");
    });
  };
  run();
  const arm = (): void => {
    setTimeout(() => {
      run();
      arm();
    }, nextUtcWindowDelay(Date.now()));
  };
  arm();
}
