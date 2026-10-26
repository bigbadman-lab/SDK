import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { PLATFORM_FEE_WALLET } from "../../../lib/launch/fees.ts";
import {
  closeLaunches,
  commitChildFees,
  commitLaunches,
  disableChildFees,
} from "../../transaction-builder/src/sdk-launch-cli.ts";
import { createSql } from "./postgres.ts";

const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const VENT = "7Rrmq49nP4pFckExFxybJuqFwQbiKeGedbD22w5twvQB";
const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const CANONICAL = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const HASH = "cd".repeat(32);
const SIGNATURE = "6".repeat(88);
const OBSOLETE = "20261022013000_trest07l_continuous_windows.sql";

test("launch activation updates one flag at a time and leaves TREST receipts untouched", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sdk-launch-"));
  const database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55452,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let sql: ReturnType<typeof createSql> | null = null;
  let other: ReturnType<typeof createSql> | null = null;
  try {
    await database.initialise();
    await database.start();
    await database.createDatabase("rewards");
    const url = "postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55452/rewards";
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.notEqual(url, process.env.DATABASE_URL);
    sql = createSql(url);
    other = createSql(url);
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
          'production', 'SDK', ${CANONICAL}, ${PLATFORM_FEE_WALLET}, ${PLATFORM_FEE_WALLET}, 'single_recipient',
          ${TOKEN}, 6, false, '11111111111111111111111111111111', true, 'canonical', now(), ${PLATFORM_FEE_WALLET}, ${HASH}
        )
      `;
    });
    await db`
      insert into child_fee_distributions (
        idempotency_key, child_mint_address, quote_mint_address, scope, status, signature, amount
      ) values (
        'vent-historical-confirmed', ${VENT}, ${TREST}, 'test', 'confirmed', ${SIGNATURE}, '81561710516'
      )
    `;
    await db`
      insert into child_fee_receipts (
        distribution_id, recipient_address, quote_mint_address, amount, role, signature
      )
      select id, ${DEPLOYER}, ${TREST}, '81561710516', 'launcher', ${SIGNATURE}
      from child_fee_distributions
      where idempotency_key = 'vent-historical-confirmed'
    `;
    assert.equal(await commitChildFees(db, OTHER), "blocked");
    assert.equal(await commitLaunches(db, CANONICAL), "ok");
    await db`update sdk_parent_config set launches_active = false where id = 1`;
    const raced = await Promise.all([commitChildFees(db, CANONICAL), commitChildFees(other, CANONICAL)]);
    assert.deepEqual(raced.slice().sort(), ["idempotent", "ok"]);
    const afterFees = await db<{ rewards: boolean; launches: boolean; fees: boolean; trest: string; amount: string }[]>`
      select rewards_active as rewards,
             launches_active as launches,
             child_fees_active as fees,
             (select mint_address from parent_registrations where scope = 'test') as trest,
             (select amount from child_fee_receipts) as amount
      from sdk_parent_config
      where id = 1
    `;
    assert.equal(afterFees[0]?.rewards, false);
    assert.equal(afterFees[0]?.launches, false);
    assert.equal(afterFees[0]?.fees, true);
    assert.equal(afterFees[0]?.trest, TREST);
    assert.equal(afterFees[0]?.amount, "81561710516");
    assert.equal(await commitChildFees(db, CANONICAL), "idempotent");
    assert.equal(await commitLaunches(db, CANONICAL), "ok");
    assert.equal(await commitLaunches(db, CANONICAL), "idempotent");
    const opened = await db<{ rewards: boolean; launches: boolean; fees: boolean; mint: string }[]>`
      select rewards_active as rewards, launches_active as launches, child_fees_active as fees, mint_address as mint
      from sdk_parent_config where id = 1
    `;
    assert.equal(opened[0]?.rewards, false);
    assert.equal(opened[0]?.launches, true);
    assert.equal(opened[0]?.fees, true);
    assert.equal(opened[0]?.mint, CANONICAL);
    assert.equal(await closeLaunches(db, CANONICAL), "ok");
    assert.equal(await closeLaunches(db, CANONICAL), "idempotent");
    assert.equal(await disableChildFees(db, CANONICAL), "ok");
    assert.equal(await disableChildFees(db, CANONICAL), "idempotent");
    const closed = await db<{ rewards: boolean; launches: boolean; fees: boolean; receipts: string }[]>`
      select rewards_active as rewards,
             launches_active as launches,
             child_fees_active as fees,
             (select count(*) from child_fee_receipts)::text as receipts
      from sdk_parent_config where id = 1
    `;
    assert.equal(closed[0]?.rewards, false);
    assert.equal(closed[0]?.launches, false);
    assert.equal(closed[0]?.fees, false);
    assert.equal(closed[0]?.receipts, "1");
    await db.unsafe(`
      create or replace function public.sdk_force_rewards() returns trigger language plpgsql as $$
      begin
        new.rewards_active = true;
        return new;
      end $$;
      create trigger sdk_force_rewards before update on public.sdk_parent_config
      for each row execute function public.sdk_force_rewards();
    `);
    assert.equal(await commitChildFees(db, CANONICAL), "blocked");
    await db.unsafe(`drop trigger sdk_force_rewards on public.sdk_parent_config`);
    const rolled = await db<{ rewards: boolean; fees: boolean }[]>`
      select rewards_active as rewards, child_fees_active as fees from sdk_parent_config where id = 1
    `;
    assert.equal(rolled[0]?.rewards, false);
    assert.equal(rolled[0]?.fees, false);
  } finally {
    await sql?.end({ timeout: 5 });
    await other?.end({ timeout: 5 });
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
