import { createHash } from "node:crypto";

import postgres from "postgres";

import type { BuildRow, BuildStore, LaunchRecord, LaunchStore, NonceStore, ParentRow, ParentStore } from "./domain.ts";

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

function lockKey(wallet: string): number {
  return createHash("sha256").update(wallet).digest().readInt32BE(0);
}

export function postgresStores(sql: Sql): {
  launches: LaunchStore;
  parent: ParentStore;
  builds: BuildStore;
  nonces: NonceStore;
} {
  return {
    launches: {
      async get(launchId) {
        const rows = await sql<LaunchRecord[]>`
          select
            l.id as "launchId",
            l.account_id as "accountId",
            l.wallet_address as "walletAddress",
            l.idempotency_key as "idempotencyKey",
            l.status,
            l.source_kind as "sourceKind",
            case when l.source_kind = 'draft' then l.draft_id::text else l.library_sdk_id::text end as "sourceId",
            case when l.source_kind = 'library' then l.library_version_id::text else l.content_hash end as "versionId",
            l.content_hash as "contentHash",
            l.origin,
            l.originator_account_id as "originatorAccountId",
            o.wallet_address as "originatorWallet",
            l.fee_category as "feeCategory",
            l.token_name as "tokenName",
            l.token_symbol as "tokenSymbol",
            l.metadata_hash as "metadataHash",
            l.metadata_ipfs_uri as "metadataUri",
            l.buy_amount as "buyAmount",
            l.slippage_bps as "slippageBps"
          from token_launches l
          left join accounts o on o.id = l.originator_account_id
          where l.id = ${launchId}
        `;
        return rows[0] ?? null;
      },
    },
    parent: {
      async get() {
        const rows = await sql<ParentRow[]>`
          select
            mint_address as "mintAddress",
            token_program as "tokenProgram",
            alt_address as "altAddress",
            alt_authority as "altAuthority",
            alt_status as "altStatus"
          from sdk_parent_config
          where id = 1
        `;
        return rows[0] ?? null;
      },
    },
    builds: {
      async find(accountId, idempotencyKey) {
        const rows = await sql<BuildRow[]>`
          select
            account_id as "accountId",
            wallet_address as "walletAddress",
            launch_id as "launchId",
            idempotency_key as "idempotencyKey",
            payload_hash as "payloadHash",
            message_hash as "messageHash",
            transaction,
            floor(extract(epoch from expires_at) * 1000) as "expiresAt",
            parent_mint_address as "parentMint",
            mint_address as "mintAddress",
            blockhash,
            content_hash as "contentHash",
            metadata_hash as "metadataHash",
            metadata_uri as "metadataUri",
            buy_amount as "buyAmount",
            shareholders::text as "shareholdersJson"
          from launch_builds
          where account_id = ${accountId} and idempotency_key = ${idempotencyKey}
        `;
        const row = rows[0];
        return row ? { ...row, expiresAt: Number(row.expiresAt) } : null;
      },
      async openLaunchIds(wallet, exceptKey, now) {
        const rows = await sql<{ launchId: string }[]>`
          select launch_id as "launchId"
          from launch_builds
          where wallet_address = ${wallet}
            and status = 'built'
            and expires_at > ${new Date(now).toISOString()}
            and idempotency_key <> ${exceptKey}
        `;
        return rows.map((row) => row.launchId);
      },
      async insert(row) {
        return sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${lockKey(row.walletAddress)})`;
          const open = await tx<{ launchId: string }[]>`
            select launch_id as "launchId"
            from launch_builds
            where wallet_address = ${row.walletAddress}
              and status = 'built'
              and expires_at > now()
              and idempotency_key <> ${row.idempotencyKey}
          `;
          if (open.length > 0) return "conflict" as const;
          const inserted = await tx<{ id: string }[]>`
            insert into launch_builds (
              launch_id, account_id, wallet_address, idempotency_key, payload_hash,
              mint_address, parent_mint_address, content_hash, metadata_hash, metadata_uri,
              fee_category, shareholders, buy_amount, slippage_bps, blockhash,
              message_hash, transaction, coverage, status, expires_at
            )
            select
              ${row.launchId}, ${row.accountId}, ${row.walletAddress}, ${row.idempotencyKey}, ${row.payloadHash},
              ${row.mintAddress}, ${row.parentMint}, l.content_hash, l.metadata_hash, l.metadata_ipfs_uri,
              l.fee_category, ${sql.json(JSON.parse(row.shareholdersJson))}, l.buy_amount, l.slippage_bps, ${row.blockhash},
              ${row.messageHash}, ${row.transaction}, 'live', 'built', ${new Date(row.expiresAt).toISOString()}
            from token_launches l
            where l.id = ${row.launchId}
              and l.status = 'ready_for_transaction'
              and l.content_hash = ${row.contentHash}
              and l.metadata_hash = ${row.metadataHash}
              and l.metadata_ipfs_uri = ${row.metadataUri}
              and l.buy_amount = ${row.buyAmount}
            on conflict (account_id, idempotency_key) do nothing
            returning id
          `;
          return inserted.length === 1 ? "ok" as const : "conflict" as const;
        });
      },
      async replace(row) {
        return sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${lockKey(row.walletAddress)})`;
          const updated = await tx<{ id: string }[]>`
            update launch_builds
            set payload_hash = ${row.payloadHash},
                message_hash = ${row.messageHash},
                transaction = ${row.transaction},
                blockhash = ${row.blockhash},
                parent_mint_address = ${row.parentMint},
                expires_at = ${new Date(row.expiresAt).toISOString()},
                status = 'built',
                updated_at = now()
            where account_id = ${row.accountId}
              and idempotency_key = ${row.idempotencyKey}
              and payload_hash = ${row.payloadHash}
              and expires_at <= now()
            returning id
          `;
          return updated.length === 1 ? "ok" as const : "conflict" as const;
        });
      },
    },
    nonces: {
      async use(nonce) {
        const inserted = await sql<{ nonce: string }[]>`
          insert into builder_nonces (nonce)
          values (${nonce})
          on conflict (nonce) do nothing
          returning nonce
        `;
        await sql`delete from builder_nonces where seen_at < now() - interval '1 day'`;
        return inserted.length === 1 ? "ok" : "replay";
      },
    },
  };
}

type Memory = {
  launches: Map<string, LaunchRecord>;
  parent: ParentRow | null;
  builds: BuildRow[];
  nonces: Set<string>;
};

export function memoryStores(seed: Memory): {
  launches: LaunchStore;
  parent: ParentStore;
  builds: BuildStore;
  nonces: NonceStore;
} {
  let queue = Promise.resolve();
  const lock = <T>(run: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    launches: { async get(id) { return seed.launches.get(id) ?? null; } },
    parent: { async get() { return seed.parent; } },
    nonces: {
      async use(nonce) {
        return lock(() => {
          if (seed.nonces.has(nonce)) return "replay" as const;
          seed.nonces.add(nonce);
          return "ok" as const;
        });
      },
    },
    builds: {
      async find(accountId, idempotencyKey) {
        return seed.builds.find((row) => row.accountId === accountId && row.idempotencyKey === idempotencyKey) ?? null;
      },
      async openLaunchIds(wallet, exceptKey, now) {
        return seed.builds
          .filter((row) => row.walletAddress === wallet && row.idempotencyKey !== exceptKey && row.expiresAt > now)
          .map((row) => row.launchId);
      },
      async insert(row) {
        return lock(() => {
          const open = seed.builds.some(
            (item) => item.walletAddress === row.walletAddress && item.idempotencyKey !== row.idempotencyKey && item.expiresAt > Date.now(),
          );
          if (open) return "conflict" as const;
          if (seed.builds.some((item) => item.accountId === row.accountId && item.idempotencyKey === row.idempotencyKey)) {
            return "conflict" as const;
          }
          seed.builds.push(row);
          return "ok" as const;
        });
      },
      async replace(row) {
        return lock(() => {
          const index = seed.builds.findIndex(
            (item) => item.accountId === row.accountId && item.idempotencyKey === row.idempotencyKey && item.payloadHash === row.payloadHash,
          );
          const current = seed.builds[index];
          if (!current || current.expiresAt > Date.now()) return "conflict" as const;
          seed.builds[index] = row;
          return "ok" as const;
        });
      },
    },
  };
}
