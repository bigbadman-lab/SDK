import postgres from "postgres";

import type { FeeReceipt } from "../../../lib/rewards/ledger.ts";
import type { RegisteredParent, RewardControl, RewardsStore, StoredClaim, StoredIntent, StoredSnapshot } from "./store.ts";

type Sql = ReturnType<typeof postgres>;

function sslMode(url: string): "require" | false {
  try {
    const hostname = new URL(url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  } catch {
    return "require";
  }
  return "require";
}

export function createSql(url: string): Sql {
  return postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: sslMode(url),
  });
}

function parentFrom(row: RegisteredParent | undefined): RegisteredParent | null {
  return row ?? null;
}

export function postgresRewardsStore(sql: Sql): RewardsStore {
  return {
    async parent(scope) {
      const rows = await sql<RegisteredParent[]>`
        select
          id::text,
          scope,
          symbol,
          mint_address as "mintAddress",
          deployer_address as "deployerAddress",
          fee_recipient_address as "feeRecipientAddress",
          fee_mode as "feeMode",
          token_program as "tokenProgram",
          decimals,
          graduated,
          quote_mint_address as "quoteMintAddress",
          eligible
        from parent_registrations
        where scope = ${scope} and eligible = true
        limit 1
      `;
      return parentFrom(rows[0]);
    },
    async control(parentMint, scope) {
      const rows = await sql<RewardControl[]>`
        select
          signer_suspended as suspended,
          reserve_lamports::text as "reserveLamports",
          cycle_cap_lamports::text as "cycleCapLamports",
          slippage_bps as "slippageBps"
        from reward_controls
        where parent_mint_address = ${parentMint} and scope = ${scope}
      `;
      return rows[0] ?? null;
    },
    async intents(parentMint, scope) {
      return sql<StoredIntent[]>`
        select
          idempotency_key as "idempotencyKey",
          parent_mint_address as "parentMint",
          scope,
          kind,
          status,
          signature,
          amount_lamports::text as "amountLamports",
          token_amount as "tokenAmount",
          message_sha256 as "messageSha256"
        from reward_intents
        where parent_mint_address = ${parentMint} and scope = ${scope}
      `;
    },
    async recordIntent(intent) {
      const rows = await sql<{ id: string }[]>`
        insert into reward_intents (
          parent_registration_id, parent_mint_address, scope, kind, idempotency_key, status, amount_lamports, message_sha256
        )
        select id, ${intent.parentMint}, ${intent.scope}, ${intent.kind}, ${intent.idempotencyKey}, 'recorded', ${intent.amountLamports}::bigint, ${intent.messageSha256}
        from parent_registrations
        where mint_address = ${intent.parentMint} and scope = ${intent.scope}
        on conflict (parent_mint_address, scope, idempotency_key) do nothing
        returning id::text
      `;
      return rows[0] ? "ok" : "duplicate";
    },
    async markIntent(parentMint, scope, idempotencyKey, status, signature) {
      const rows = await sql<{ id: string }[]>`
        update reward_intents
        set status = ${status}, signature = coalesce(${signature}, signature)
        where parent_mint_address = ${parentMint}
          and scope = ${scope}
          and idempotency_key = ${idempotencyKey}
          and (
            (status = 'recorded' and ${signature}::text is not null)
            or status in ('submitted', 'uncertain')
          )
          and not exists (
            select 1 from reward_intents other
            where other.signature = ${signature} and other.idempotency_key <> ${idempotencyKey}
          )
        returning id::text
      `;
      return rows[0] ? "ok" : "order";
    },
    async receipts(parentMint, scope) {
      return sql<FeeReceipt[]>`
        select
          signature,
          parent_mint_address as "parentMint",
          scope,
          amount_lamports::text as "amountLamports",
          slot::text,
          true as confirmed,
          source
        from reward_collections
        where parent_mint_address = ${parentMint} and scope = ${scope} and credited = true
      `;
    },
    async saveReceipt(receipt) {
      const rows = await sql<{ id: string }[]>`
        insert into reward_collections (
          parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot, source, status,
          credited, confirmed_at, gross_lamports, network_fee_lamports, net_lamports, native_lamports,
          wsol_token_lamports, wsol_converted_lamports, rent_excluded_lamports
        )
        select
          id, ${receipt.parentMint}, ${receipt.scope}, ${receipt.signature}, ${receipt.amountLamports}::bigint,
          ${receipt.slot}::bigint, 'creator_vault', 'confirmed', true, now(), ${receipt.gross}::bigint,
          ${receipt.fee}::bigint, ${receipt.amountLamports}::bigint, ${receipt.native}::bigint,
          ${receipt.wsolConverted}::bigint, ${receipt.wsolConverted}::bigint, ${receipt.rentExcluded}::bigint
        from parent_registrations
        where mint_address = ${receipt.parentMint} and scope = ${receipt.scope}
        on conflict (signature) do nothing
        returning id::text
      `;
      return rows[0] ? "ok" : "duplicate";
    },
    async windows(parentMint, scope) {
      return sql<{ windowKey: string; collected: string; holders: string; buyback: string; deployer: string }[]>`
        select
          scope || ':' || parent_mint_address || ':' || floor(extract(epoch from window_start) * 1000)::bigint::text as "windowKey",
          collected_lamports::text as collected,
          holder_lamports::text as holders,
          buyback_lamports::text as buyback,
          deployer_retained_lamports::text as deployer
        from reward_windows
        where parent_mint_address = ${parentMint} and scope = ${scope}
      `;
    },
    async saveWindow(input) {
      const startMs = Number(input.windowKey.split(":").at(-1));
      return sql.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          insert into reward_windows (
            parent_registration_id, parent_mint_address, scope, window_start, window_end,
            collected_lamports, holder_lamports, buyback_lamports, deployer_retained_lamports, status
          )
          select
            id, ${input.parentMint}, ${input.scope}, to_timestamp(${startMs} / 1000.0), to_timestamp(${startMs + 300_000} / 1000.0),
            ${input.collected}::bigint, ${input.holders}::bigint, ${input.buyback}::bigint, ${input.deployer}::bigint, 'allocated'
          from parent_registrations
          where mint_address = ${input.parentMint} and scope = ${input.scope}
          on conflict (parent_mint_address, scope, window_start) do nothing
          returning id::text
        `;
        const windowId = rows[0]?.id;
        if (!windowId) return "duplicate";
        await tx`
          insert into reward_liabilities (
            parent_registration_id, parent_mint_address, scope, kind, amount, asset, window_id, status
          )
          select id, ${input.parentMint}, ${input.scope}, kind, amount, asset, ${windowId}::uuid, 'claimable'
          from parent_registrations
          cross join (
            values
              ('holder_sol', ${input.holders}, 'sol'),
              ('buyback_sol', ${input.buyback}, 'sol'),
              ('deployer_retained', ${input.deployer}, 'sol')
          ) as bucket(kind, amount, asset)
          where mint_address = ${input.parentMint} and scope = ${input.scope}
        `;
        return "ok";
      });
    },
    async snapshots(parentMint, scope, windowKey) {
      const startMs = Number(windowKey.split(":").at(-1));
      return sql<StoredSnapshot[]>`
        select owner_address as owner, balance, sol_lamports::text as "solLamports", token_amount as "tokenAmount", coalesce(cutoff_slot::text, '0') as "cutoffSlot"
        from reward_snapshots
        where parent_mint_address = ${parentMint} and scope = ${scope} and window_start = to_timestamp(${startMs} / 1000.0)
      `;
    },
    async saveSnapshots(parentMint, scope, windowKey, rows) {
      const startMs = Number(windowKey.split(":").at(-1));
      let inserted = 0;
      for (const row of rows) {
        const saved = await sql<{ id: string }[]>`
          insert into reward_snapshots (
            parent_registration_id, parent_mint_address, scope, window_start, owner_address, balance, sol_lamports, token_amount, cutoff_slot
          )
          select id, ${parentMint}, ${scope}, to_timestamp(${startMs} / 1000.0), ${row.owner}, ${row.balance}, ${row.solLamports}::bigint, ${row.tokenAmount}, ${row.cutoffSlot}::bigint
          from parent_registrations
          where mint_address = ${parentMint} and scope = ${scope}
          on conflict (parent_mint_address, scope, window_start, owner_address) do nothing
          returning id::text
        `;
        if (saved[0]) inserted += 1;
      }
      return inserted === rows.length ? "ok" : "duplicate";
    },
    async creditSnapshotTokens(parentMint, scope, windowKey, rows) {
      const startMs = Number(windowKey.split(":").at(-1));
      for (const row of rows) {
        const saved = await sql<{ id: string }[]>`
          update reward_snapshots
          set token_amount = ${row.tokenAmount}
          where parent_mint_address = ${parentMint} and scope = ${scope} and window_start = to_timestamp(${startMs} / 1000.0) and owner_address = ${row.owner}
          returning id::text
        `;
        if (!saved[0]) return "missing";
      }
      return "ok";
    },
    async claims(parentMint, scope) {
      return sql<StoredClaim[]>`
        select
          claim.claimant,
          case when liability.kind = 'holder_sol' then 'sol' else 'trest' end as asset,
          liability.amount,
          claim.idempotency_key as "idempotencyKey",
          case when claim.status = 'reserved' then 'recorded' else claim.status end as status,
          claim.signature,
          claim.scope,
          claim.parent_mint_address as "parentMint",
          coalesce(claim.proof_hash, '') as "proofHash"
        from reward_claims claim
        join reward_liabilities liability on liability.id = claim.liability_id
        where claim.parent_mint_address = ${parentMint} and claim.scope = ${scope}
      `;
    },
    async saveClaim(claim) {
      const kind = claim.asset === "sol" ? "holder_sol" : "buyback_token";
      const asset = claim.asset === "sol" ? "sol" : "parent_token";
      return sql.begin(async (tx) => {
        const locked = await tx<{ id: string }[]>`
          select id::text from parent_registrations
          where mint_address = ${claim.parentMint} and scope = ${claim.scope}
          for update
        `;
        if (!locked[0]) return "amount";
        const existing = await tx<{ id: string }[]>`
          select id::text from reward_claims
          where parent_mint_address = ${claim.parentMint} and scope = ${claim.scope} and idempotency_key = ${claim.idempotencyKey}
        `;
        if (existing[0]) return "duplicate";
        const blocking = await tx<{ id: string }[]>`
          select claim.id::text
          from reward_claims claim
          join reward_liabilities liability on liability.id = claim.liability_id
          where claim.parent_mint_address = ${claim.parentMint}
            and claim.scope = ${claim.scope}
            and claim.claimant = ${claim.claimant}
            and liability.kind = ${kind}
            and claim.status in ('submitted', 'uncertain', 'unreconciled')
        `;
        if (blocking[0]) return "uncertain";
        const totals = await tx<{ entitlement: string; reserved: string }[]>`
          select
            coalesce((
              select sum(case when ${claim.asset} = 'sol' then sol_lamports else token_amount::bigint end)
              from reward_snapshots
              where parent_mint_address = ${claim.parentMint} and scope = ${claim.scope} and owner_address = ${claim.claimant}
            ), 0)::text as entitlement,
            coalesce((
              select sum(liability.amount::bigint)
              from reward_claims claim
              join reward_liabilities liability on liability.id = claim.liability_id
              where claim.parent_mint_address = ${claim.parentMint}
                and claim.scope = ${claim.scope}
                and claim.claimant = ${claim.claimant}
                and liability.kind = ${kind}
                and claim.status <> 'failed'
            ), 0)::text as reserved
        `;
        const entitlement = BigInt(totals[0]?.entitlement ?? "0");
        const reserved = BigInt(totals[0]?.reserved ?? "0");
        if (reserved + BigInt(claim.amount) > entitlement) return "amount";
        const liability = await tx<{ id: string }[]>`
          insert into reward_liabilities (
            parent_registration_id, parent_mint_address, scope, kind, amount, asset, status
          )
          select id, ${claim.parentMint}, ${claim.scope}, ${kind}, ${claim.amount}, ${asset}, 'claimable'
          from parent_registrations
          where mint_address = ${claim.parentMint} and scope = ${claim.scope}
          returning id::text
        `;
        if (!liability[0]) return "amount";
        const saved = await tx<{ id: string }[]>`
          insert into reward_claims (
            liability_id, parent_mint_address, scope, claimant, status, idempotency_key, proof_hash
          )
          values (
            ${liability[0].id}::uuid, ${claim.parentMint}, ${claim.scope}, ${claim.claimant}, 'reserved', ${claim.idempotencyKey}, ${claim.proofHash}
          )
          returning id::text
        `;
        return saved[0] ? "ok" : "amount";
      });
    },
    async markClaim(parentMint, scope, idempotencyKey, status, signature) {
      const rows = await sql<{ id: string }[]>`
        update reward_claims
        set status = ${status}, signature = coalesce(${signature}, signature)
        where parent_mint_address = ${parentMint}
          and scope = ${scope}
          and idempotency_key = ${idempotencyKey}
          and status in ('reserved', 'submitted', 'uncertain')
          and ${status} in ('submitted', 'confirmed', 'failed', 'uncertain', 'unreconciled')
        returning id::text
      `;
      return rows[0] ? "ok" : "order";
    },
    async tryLock(parentMint, scope, holder, nowMs) {
      if (!Number.isFinite(nowMs)) return "locked";
      const rows = await sql<{ holder: string }[]>`
        insert into reward_cycle_locks (parent_mint_address, scope, holder, expires_at)
        values (${parentMint}, ${scope}, ${holder}, now() + interval '5 minutes')
        on conflict (parent_mint_address, scope) do update
        set holder = excluded.holder, locked_at = now(), expires_at = excluded.expires_at
        where reward_cycle_locks.holder = excluded.holder or reward_cycle_locks.expires_at <= now()
        returning holder
      `;
      return rows[0]?.holder === holder ? "ok" : "locked";
    },
    async unlock(parentMint, scope, holder) {
      await sql`
        delete from reward_cycle_locks
        where parent_mint_address = ${parentMint} and scope = ${scope} and holder = ${holder}
      `;
    },
  };
}
