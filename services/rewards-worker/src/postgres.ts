import postgres from "postgres";

import { allocateWindow, windowKey } from "../../../lib/rewards/cycle.ts";
import { planIncrementalAllocation, type FeeReceipt } from "../../../lib/rewards/ledger.ts";
import { TREST_REHEARSAL_MINT, validRehearsalStarts, type LegacyRecovery, type RegisteredParent, type RewardControl, type RewardsStore, type StoredClaim, type StoredIntent, type StoredSnapshot, type WindowAllocation } from "./store.ts";
import { matchesLegacyCollection } from "./legacy-recovery.ts";

type Sql = ReturnType<typeof postgres>;

class AllocationStop extends Error {
  allocationCode: "amount" | "duplicate" | "window";

  constructor(allocationCode: "amount" | "duplicate" | "window") {
    super(allocationCode);
    this.allocationCode = allocationCode;
  }
}

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
    async solObligations(parentMint, scope) {
      const liabilities = await sql<{ holder: string; deployer: string; buyback: string }[]>`
        select
          coalesce(sum(amount::bigint) filter (where kind = 'holder_sol'), 0)::text as holder,
          coalesce(sum(amount::bigint) filter (where kind = 'deployer_retained'), 0)::text as deployer,
          coalesce(sum(amount::bigint) filter (where kind = 'buyback_sol'), 0)::text as buyback
        from reward_liabilities
        where parent_mint_address = ${parentMint} and scope = ${scope} and status <> 'suspended'
      `;
      const paid = await sql<{ holder: string; buyback: string }[]>`
        select
          coalesce((
            select sum(liability.amount::bigint)
            from reward_claims claim
            join reward_liabilities liability on liability.id = claim.liability_id
            where claim.parent_mint_address = ${parentMint}
              and claim.scope = ${scope}
              and claim.status = 'confirmed'
              and liability.kind = 'holder_sol'
          ), 0)::text as holder,
          coalesce((
            select sum(amount_lamports)
            from reward_intents
            where parent_mint_address = ${parentMint} and scope = ${scope} and kind = 'buyback' and status = 'confirmed'
          ), 0)::text as buyback
      `;
      return {
        holderSol: liabilities[0]?.holder ?? "0",
        confirmedHolderSol: paid[0]?.holder ?? "0",
        deployerRetained: liabilities[0]?.deployer ?? "0",
        buybackSol: liabilities[0]?.buyback ?? "0",
        confirmedBuybackSol: paid[0]?.buyback ?? "0",
      };
    },
    async allocateUnallocated(input): Promise<WindowAllocation> {
      const startMs = Number(input.windowKey.split(":").at(-1));
      if (!Number.isInteger(startMs) || windowKey(input.parentMint, input.scope, startMs + 1) !== input.windowKey) {
        return { ok: false, code: "window" };
      }
      try {
      return await sql.begin(async (tx) => {
        const parents = await tx<{ id: string }[]>`
          select id::text from parent_registrations
          where mint_address = ${input.parentMint} and scope = ${input.scope}
          for update
        `;
        if (!parents[0]) throw new AllocationStop("window");
        const existing = await tx<{ base: string; holders: string; buyback: string; deployer: string }[]>`
          select
            collected_lamports::text as base,
            holder_lamports::text as holders,
            buyback_lamports::text as buyback,
            deployer_retained_lamports::text as deployer
          from reward_windows
          where parent_mint_address = ${input.parentMint}
            and scope = ${input.scope}
            and window_start = to_timestamp(${startMs} / 1000.0)
        `;
        if (existing[0]) {
          return { ok: true, state: "duplicate", base: existing[0].base, holders: existing[0].holders, buyback: existing[0].buyback, deployer: existing[0].deployer, withheld: "0" };
        }
        const open = await tx<{ id: string; signature: string; amount: string }[]>`
          select id::text, signature, amount_lamports::text as amount
          from reward_collections
          where parent_mint_address = ${input.parentMint}
            and scope = ${input.scope}
            and credited = true
            and status = 'confirmed'
            and allocated_at is null
          order by signature
          for update
        `;
        if (open.length === 0) return { ok: true, state: "empty" };
        const allocated = await tx<{ signature: string }[]>`
          select signature from reward_collections
          where parent_mint_address = ${input.parentMint} and scope = ${input.scope} and allocated_at is not null
        `;
        const gross = open.reduce((total, receipt) => total + BigInt(receipt.amount), BigInt(0));
        const guard = allocateWindow({
          parentMint: input.parentMint,
          scope: input.scope,
          timestampMs: startMs + 1,
          netLamports: gross.toString(),
          reserveLamports: "0",
          receiptSignatures: open.map((receipt) => receipt.signature),
          allocatedSignatures: allocated.map((receipt) => receipt.signature),
          existingWindowKeys: [],
        });
        if (!guard.ok) throw new AllocationStop("duplicate");
        const withheldRows = await tx<{ withheld: string }[]>`
          select coalesce(sum(reserve_withheld_lamports), 0)::text as withheld
          from reward_collections
          where parent_mint_address = ${input.parentMint} and scope = ${input.scope} and allocated_at is not null
        `;
        const planned = planIncrementalAllocation({
          grossLamports: gross.toString(),
          reserveLamports: input.reserveLamports,
          reserveWithheldLamports: withheldRows[0]?.withheld ?? "0",
        });
        if (!planned.ok) throw new AllocationStop("amount");
        let remaining = BigInt(planned.withheld);
        const shares = open.map((receipt) => {
          const amount = BigInt(receipt.amount);
          const take = remaining > amount ? amount : remaining;
          remaining -= take;
          return { id: receipt.id, withheld: take };
        });
        if (remaining !== BigInt(0)) throw new AllocationStop("amount");
        let windowId: string | null = null;
        if (planned.base !== "0") {
          const inserted = await tx<{ id: string }[]>`
            insert into reward_windows (
              parent_registration_id, parent_mint_address, scope, window_start, window_end,
              collected_lamports, holder_lamports, buyback_lamports, deployer_retained_lamports, status
            )
            select
              id, ${input.parentMint}, ${input.scope}, to_timestamp(${startMs} / 1000.0), to_timestamp(${startMs + 300_000} / 1000.0),
              ${planned.base}::bigint, ${planned.holders}::bigint, ${planned.buyback}::bigint, ${planned.deployer}::bigint, 'allocated'
            from parent_registrations
            where mint_address = ${input.parentMint} and scope = ${input.scope}
            returning id::text
          `;
          windowId = inserted[0]?.id ?? null;
          if (!windowId) throw new AllocationStop("window");
          await tx`
            insert into reward_liabilities (
              parent_registration_id, parent_mint_address, scope, kind, amount, asset, window_id, status
            )
            select id, ${input.parentMint}, ${input.scope}, kind, amount, asset, ${windowId}::uuid, 'claimable'
            from parent_registrations
            cross join (
              values
                ('holder_sol', ${planned.holders}, 'sol'),
                ('buyback_sol', ${planned.buyback}, 'sol'),
                ('deployer_retained', ${planned.deployer}, 'sol')
            ) as bucket(kind, amount, asset)
            where mint_address = ${input.parentMint} and scope = ${input.scope}
          `;
        }
        for (const share of shares) {
          const updated = await tx<{ id: string }[]>`
            update reward_collections
            set allocated_at = now(),
                reserve_withheld_lamports = ${share.withheld.toString()}::bigint,
                reward_window_id = ${windowId}::uuid
            where id = ${share.id}::uuid and allocated_at is null
            returning id::text
          `;
          if (!updated[0]) throw new AllocationStop("duplicate");
        }
        if (planned.base === "0") return { ok: true, state: "reserved", withheld: planned.withheld };
        return {
          ok: true,
          state: "allocated",
          base: planned.base,
          holders: planned.holders,
          buyback: planned.buyback,
          deployer: planned.deployer,
          withheld: planned.withheld,
        };
      });
      } catch (error) {
        if (error instanceof AllocationStop) return { ok: false, code: error.allocationCode };
        throw error;
      }
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
          message_sha256 as "messageSha256",
          recent_blockhash as "recentBlockhash",
          submission_code as "submissionCode",
          submission_detail as "submissionDetail",
          (extract(epoch from created_at) * 1000)::bigint::text as "createdAtMs"
        from reward_intents
        where parent_mint_address = ${parentMint} and scope = ${scope}
      `;
    },
    async recordIntent(intent) {
      const rows = await sql<{ id: string }[]>`
        insert into reward_intents (
          parent_registration_id, parent_mint_address, scope, kind, idempotency_key, status, amount_lamports, message_sha256, recent_blockhash
        )
        select id, ${intent.parentMint}, ${intent.scope}, ${intent.kind}, ${intent.idempotencyKey}, 'recorded', ${intent.amountLamports}::bigint, ${intent.messageSha256}, ${intent.recentBlockhash ?? null}
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
            (status = 'recorded' and ${signature}::text is not null and ${status}::text = 'submitted')
            or status in ('submitted', 'uncertain')
            or (status = 'unreconciled' and ${status}::text in ('confirmed', 'failed'))
          )
          and not exists (
            select 1 from reward_intents other
            where other.signature = ${signature} and other.idempotency_key <> ${idempotencyKey}
          )
        returning id::text
      `;
      return rows[0] ? "ok" : "order";
    },
    async recordSubmission(parentMint, scope, idempotencyKey, note) {
      const rows = await sql<{ id: string }[]>`
        update reward_intents
        set
          recent_blockhash = coalesce(${note.recentBlockhash}, recent_blockhash),
          submission_code = coalesce(${note.submissionCode === null ? null : note.submissionCode.slice(0, 40)}, submission_code),
          submission_detail = coalesce(${note.submissionDetail === null ? null : note.submissionDetail.slice(0, 240)}, submission_detail)
        where parent_mint_address = ${parentMint}
          and scope = ${scope}
          and idempotency_key = ${idempotencyKey}
        returning id::text
      `;
      return rows[0] ? "ok" : "order";
    },
    async legacyRecoveries(parentMint, scope) {
      const rows = await sql<LegacyRecovery[]>`
        select
          id::text,
          parent_mint_address as "parentMint",
          scope,
          idempotency_key as "idempotencyKey",
          signature,
          prior_status as "priorStatus",
          operator_id as "operatorId",
          approval,
          reason,
          evidence,
          (extract(epoch from created_at) * 1000)::bigint::text as "createdAtMs"
        from reward_legacy_recoveries
        where parent_mint_address = ${parentMint} and scope = ${scope}
      `;
      return rows;
    },
    async saveLegacyRecovery(input) {
      if (!matchesLegacyCollection(input) || input.priorStatus !== "uncertain" || input.approval !== "TREST-07F-LEGACY-RECOVERY") {
        return { ok: false, code: "rejected" };
      }
      const rows = await sql<{ id: string }[]>`
        insert into reward_legacy_recoveries (
          parent_mint_address, scope, idempotency_key, signature, prior_status, operator_id, approval, reason, evidence
        ) values (
          ${input.parentMint}, ${input.scope}, ${input.idempotencyKey}, ${input.signature}, ${input.priorStatus},
          ${input.operatorId}, ${input.approval}, ${input.reason}, ${sql.json(input.evidence)}
        )
        on conflict do nothing
        returning id::text
      `;
      return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, code: "duplicate" };
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
          and status in ('reserved', 'submitted', 'uncertain', 'unreconciled')
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
    async registerRehearsal(input) {
      const starts = validRehearsalStarts(input.windowStartsMs);
      if (!starts || input.scope !== "test" || input.parentMint !== TREST_REHEARSAL_MINT) return "rejected";
      if (input.requireUpcoming && (!Number.isInteger(input.nowMs) || starts[0] <= (input.nowMs ?? 0))) return "rejected";
      try {
        const rows = await sql<{ id: string }[]>`
          insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms)
          values (
            ${input.parentMint},
            'test',
            'open',
            array[${starts[0]}::bigint, ${starts[1]}::bigint, ${starts[2]}::bigint]
          )
          on conflict (parent_mint_address, scope) do nothing
          returning id::text
        `;
        return rows[0] ? "ok" : "duplicate";
      } catch {
        return "rejected";
      }
    },
    async claimRehearsalWindow(input) {
      return sql.begin(async (tx) => {
        const rows = await tx<{ id: string; status: "open" | "stopped" | "closed"; starts: string[] }[]>`
          select id::text, status, window_start_ms::text[] as starts
          from reward_rehearsals
          where parent_mint_address = ${input.parentMint} and scope = ${input.scope}
          for update
        `;
        const row = rows[0];
        if (!row) return { ok: false as const, code: "absent" as const };
        if (row.status === "stopped") return { ok: false as const, code: "stopped" as const };
        if (row.status === "closed") return { ok: false as const, code: "closed" as const };
        const starts = row.starts.map((value) => Number(value));
        if (!starts.includes(input.windowStartMs)) return { ok: false as const, code: "schedule" as const };
        const inserted = await tx<{ outcome: string }[]>`
          insert into reward_rehearsal_windows (rehearsal_id, window_start_ms, outcome)
          values (${row.id}::uuid, ${input.windowStartMs}, 'claimed')
          on conflict (rehearsal_id, window_start_ms) do nothing
          returning outcome
        `;
        if (inserted[0]) return { ok: true as const, admission: "execute" as const };
        const existing = await tx<{ outcome: "claimed" | "ok" | "stopped" }[]>`
          select outcome
          from reward_rehearsal_windows
          where rehearsal_id = ${row.id}::uuid and window_start_ms = ${input.windowStartMs}
        `;
        if (existing[0]?.outcome === "ok") return { ok: true as const, admission: "replay" as const };
        await tx`
          update reward_rehearsal_windows
          set outcome = 'stopped'
          where rehearsal_id = ${row.id}::uuid
            and window_start_ms = ${input.windowStartMs}
            and outcome = 'claimed'
        `;
        await tx`
          update reward_rehearsals
          set status = 'stopped', closed_at = coalesce(closed_at, now())
          where id = ${row.id}::uuid and status = 'open'
        `;
        await tx`
          update reward_controls
          set signer_suspended = true, updated_at = now()
          where parent_mint_address = ${input.parentMint} and scope = ${input.scope}
        `;
        return { ok: false as const, code: "stopped" as const };
      });
    },
    async finishRehearsalWindow(input) {
      return sql.begin(async (tx) => {
        const rows = await tx<{ id: string; status: "open" | "stopped" | "closed" }[]>`
          select id::text, status
          from reward_rehearsals
          where parent_mint_address = ${input.parentMint} and scope = ${input.scope}
          for update
        `;
        const row = rows[0];
        if (!row) return "order" as const;
        if (row.status === "open" && (input.outcome === "ok" || input.outcome === "stopped")) {
          await tx`
            update reward_rehearsal_windows
            set outcome = ${input.outcome}
            where rehearsal_id = ${row.id}::uuid
              and window_start_ms = ${input.windowStartMs}
              and outcome = 'claimed'
          `;
          if (input.outcome === "stopped") {
            await tx`
              update reward_rehearsals
              set status = 'stopped', closed_at = coalesce(closed_at, now())
              where id = ${row.id}::uuid and status = 'open'
            `;
          } else {
            const done = await tx<{ ready: boolean }[]>`
              select (
                select count(*)::int
                from reward_rehearsal_windows
                where rehearsal_id = ${row.id}::uuid and outcome = 'ok'
              ) = 3 as ready
            `;
            if (done[0]?.ready) {
              await tx`
                update reward_rehearsals
                set status = 'closed', closed_at = coalesce(closed_at, now())
                where id = ${row.id}::uuid and status = 'open'
              `;
            }
          }
        }
        const after = await tx<{ status: "open" | "stopped" | "closed" }[]>`
          select status from reward_rehearsals where id = ${row.id}::uuid
        `;
        if (after[0]?.status === "stopped" || after[0]?.status === "closed") {
          await tx`
            update reward_controls
            set signer_suspended = true, updated_at = now()
            where parent_mint_address = ${input.parentMint} and scope = ${input.scope}
          `;
        }
        return "ok" as const;
      });
    },
    async rehearsalState(parentMint, scope) {
      const rows = await sql<{ status: "open" | "stopped" | "closed"; starts: string[] }[]>`
        select status, window_start_ms::text[] as starts
        from reward_rehearsals
        where parent_mint_address = ${parentMint} and scope = ${scope}
      `;
      const row = rows[0];
      if (!row) return null;
      const processed = await sql<{ windowStartMs: string; outcome: "claimed" | "ok" | "stopped" }[]>`
        select w.window_start_ms::text as "windowStartMs", w.outcome
        from reward_rehearsal_windows w
        join reward_rehearsals r on r.id = w.rehearsal_id
        where r.parent_mint_address = ${parentMint} and r.scope = ${scope}
      `;
      return {
        status: row.status,
        windowStartsMs: row.starts.map((value) => Number(value)),
        processed: processed.map((item) => ({ windowStartMs: Number(item.windowStartMs), outcome: item.outcome })),
        blocksSideWork: true,
      };
    },
    async rehearsalBlocksSideWork(parentMint, scope) {
      const rows = await sql<{ id: string }[]>`
        select id::text
        from reward_rehearsals
        where parent_mint_address = ${parentMint} and scope = ${scope}
        limit 1
      `;
      return Boolean(rows[0]);
    },
  };
}
