import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { commitRewardsActivation } from "../../transaction-builder/src/sdk-activate-cli.ts";
import { createSql } from "./postgres.ts";

const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const CANONICAL = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const HASH = "cd".repeat(32);
const SIGNATURE = "6".repeat(88);
const OBSOLETE = "20261022013000_trest07l_continuous_windows.sql";

test("activation updates only rewards_active on a disposable database", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sdk-activate-"));
  const database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55450,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let sql: ReturnType<typeof createSql> | null = null;
  try {
    await database.initialise();
    await database.start();
    await database.createDatabase("rewards");
    const url = "postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55450/rewards";
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.notEqual(url, process.env.DATABASE_URL);
    sql = createSql(url);
    const db = sql;
    await db.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end $$;
      create schema if not exists storage;
      create table if not exists storage.buckets (
        id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
    `);
    const migrationDir = path.resolve(import.meta.dirname, "../../../supabase/migrations");
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql") && file !== OBSOLETE).sort();
    for (const file of files) await db.unsafe(await readFile(path.join(migrationDir, file), "utf8"));
    await db`
      insert into parent_registrations (
        scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
        token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
        verified_at, registered_by, evidence_hash
      ) values (
        'test', 'TREST', ${TREST}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
        ${TOKEN}, 6, false, '11111111111111111111111111111111', true, 'verified', now(), ${DEPLOYER}, ${HASH}
      )
    `;
    await db`
      insert into reward_collections (
        parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot, source, status, credited, confirmed_at
      )
      select id, ${TREST}, 'test', ${SIGNATURE}, 1000, 1, 'creator_vault', 'confirmed', true, now()
      from parent_registrations
      where mint_address = ${TREST}
    `;
    await db.begin(async (tx) => {
      await tx`
        insert into sdk_parent_config (
          id, mint_address, token_program, decimals, quote_mint_address, eligible, eligibility_reason,
          graduated, rewards_active, alt_status
        ) values (
          1, ${CANONICAL}, ${TOKEN}, 6, '11111111111111111111111111111111', true, 'canonical', false, false, 'absent'
        )
      `;
      await tx`
        insert into parent_registrations (
          scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
          token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
          verified_at, registered_by, evidence_hash
        ) values (
          'production', 'SDK', ${CANONICAL}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
          ${TOKEN}, 6, false, '11111111111111111111111111111111', true, 'canonical', now(), ${DEPLOYER}, ${HASH}
        )
      `;
    });
    assert.equal(await commitRewardsActivation(db, OTHER), "blocked");
    const before = await db<{ rewards: boolean; mint: string; trest: string; collections: string }[]>`
      select
        rewards_active as rewards,
        mint_address as mint,
        (select mint_address from parent_registrations where scope = 'test') as trest,
        (select count(*) from reward_collections)::text as collections
      from sdk_parent_config
      where id = 1
    `;
    assert.equal(before[0]?.rewards, false);
    assert.equal(await commitRewardsActivation(db, CANONICAL), "ok");
    assert.equal(await commitRewardsActivation(db, CANONICAL), "idempotent");
    const after = await db<{ rewards: boolean; mint: string; trest: string; collections: string; amount: string }[]>`
      select
        rewards_active as rewards,
        mint_address as mint,
        (select mint_address from parent_registrations where scope = 'test') as trest,
        (select count(*) from reward_collections)::text as collections,
        (select amount_lamports from reward_collections)::text as amount
      from sdk_parent_config
      where id = 1
    `;
    assert.equal(after[0]?.rewards, true);
    assert.equal(after[0]?.mint, CANONICAL);
    assert.equal(after[0]?.trest, TREST);
    assert.equal(after[0]?.collections, "1");
    assert.equal(after[0]?.amount, "1000");
    assert.equal(after[0]?.mint, before[0]?.mint);
  } finally {
    await sql?.end({ timeout: 5 });
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
