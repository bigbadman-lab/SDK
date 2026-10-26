import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { createSql } from "./postgres.ts";

const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const CANONICAL = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const HASH = "ab".repeat(32);
const SIGNATURE = "4".repeat(88);
const OBSOLETE = "20261022013000_trest07l_continuous_windows.sql";
const CANONICAL_MIGRATION = "20261026190000_sdk_prod_01a_canonical_parent.sql";

test("the unapplied canonical migration preserves TREST and freezes one mint", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sdk-canonical-"));
  const database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55449,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let sql: ReturnType<typeof createSql> | null = null;
  try {
    await database.initialise();
    await database.start();
    await database.createDatabase("rewards");
    const url = "postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55449/rewards";
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
    const deployed = (await readdir(migrationDir))
      .filter((file) => file.endsWith(".sql") && file !== OBSOLETE && file !== CANONICAL_MIGRATION)
      .sort();
    assert.equal(deployed.at(-1), "20261025140000_library_sdk_votes.sql");
    for (const file of deployed) await db.unsafe(await readFile(path.join(migrationDir, file), "utf8"));
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
      insert into reward_controls (
        parent_registration_id, parent_mint_address, scope, signer_suspended, reserve_lamports, cycle_cap_lamports, slippage_bps
      )
      select id, ${TREST}, 'test', true, 0, 1000000000, 100
      from parent_registrations
      where mint_address = ${TREST}
    `;
    await db`
      insert into reward_collections (
        parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot, source, status, credited, confirmed_at
      )
      select id, ${TREST}, 'test', ${SIGNATURE}, 1000, 1, 'creator_vault', 'confirmed', true, now()
      from parent_registrations
      where mint_address = ${TREST}
    `;
    const before = await db<{ mint: string; collections: string; suspended: boolean }[]>`
      select
        parent.mint_address as mint,
        (select count(*) from reward_collections)::text as collections,
        control.signer_suspended as suspended
      from parent_registrations parent
      join reward_controls control on control.parent_registration_id = parent.id
      where parent.scope = 'test'
    `;
    await db.unsafe(await readFile(path.join(migrationDir, CANONICAL_MIGRATION), "utf8"));
    const after = await db<{ mint: string; collections: string; suspended: boolean; amount: string }[]>`
      select
        parent.mint_address as mint,
        (select count(*) from reward_collections)::text as collections,
        control.signer_suspended as suspended,
        collection.amount_lamports::text as amount
      from parent_registrations parent
      join reward_controls control on control.parent_registration_id = parent.id
      join reward_collections collection on collection.parent_registration_id = parent.id
      where parent.scope = 'test'
    `;
    assert.equal(after[0]?.mint, TREST);
    assert.equal(after[0]?.mint, before[0]?.mint);
    assert.equal(after[0]?.collections, "1");
    assert.equal(after[0]?.collections, before[0]?.collections);
    assert.equal(after[0]?.suspended, true);
    assert.equal(after[0]?.amount, "1000");
    const column = await db<{ nullable: string; fallback: string | null }[]>`
      select is_nullable as nullable, column_default as fallback
      from information_schema.columns
      where table_schema = 'public' and table_name = 'sdk_parent_config' and column_name = 'rewards_active'
    `;
    assert.equal(column[0]?.nullable, "NO");
    assert.match(column[0]?.fallback ?? "", /false/);
    const empty = await db<{ configs: string; production: string }[]>`
      select
        (select count(*) from sdk_parent_config)::text as configs,
        (select count(*) from parent_registrations where scope = 'production')::text as production
    `;
    assert.deepEqual(empty[0], { configs: "0", production: "0" });
    await assert.rejects(
      () => db`
        insert into parent_registrations (
          scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
          token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
          verified_at, registered_by, evidence_hash
        ) values (
          'production', 'SDK', ${CANONICAL}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
          ${TOKEN}, 6, false, '11111111111111111111111111111111', true, 'canonical', now(), ${DEPLOYER}, ${HASH}
        )
      `,
      /canonical parent identity diverged/,
    );
    await assert.rejects(
      () => db`
        insert into sdk_parent_config (
          id, mint_address, token_program, decimals, quote_mint_address, eligible, eligibility_reason,
          graduated, rewards_active, alt_status
        ) values (
          1, ${CANONICAL}, ${TOKEN}, 6, '11111111111111111111111111111111', true, 'canonical', false, false, 'absent'
        )
      `,
      /canonical parent identity diverged/,
    );
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
    const registered = await db<{ mint: string; rewards: boolean; trest: string }[]>`
      select
        config.mint_address as mint,
        config.rewards_active as rewards,
        (select mint_address from parent_registrations where scope = 'test') as trest
      from sdk_parent_config config
      where config.id = 1
    `;
    assert.equal(registered[0]?.mint, CANONICAL);
    assert.equal(registered[0]?.rewards, false);
    assert.equal(registered[0]?.trest, TREST);
    await assert.rejects(
      () => db`update sdk_parent_config set mint_address = ${OTHER} where id = 1`,
      /canonical mint is immutable/,
    );
    await assert.rejects(
      () => db`update sdk_parent_config set rewards_active = true, mint_address = null where id = 1`,
      /canonical mint is immutable/,
    );
    await db`update parent_registrations set eligibility_reason = 'verified' where scope = 'test'`;
    await assert.rejects(
      () => db`update parent_registrations set mint_address = ${OTHER} where scope = 'test'`,
      /parent identity is immutable/,
    );
    const preserved = await db<{ collections: string; amount: string; suspended: boolean }[]>`
      select
        (select count(*) from reward_collections)::text as collections,
        (select amount_lamports from reward_collections)::text as amount,
        (select signer_suspended from reward_controls where scope = 'test') as suspended
    `;
    assert.deepEqual(preserved[0], { collections: "1", amount: "1000", suspended: true });
  } finally {
    await sql?.end({ timeout: 5 });
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
