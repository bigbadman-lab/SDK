import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { commitChildFees } from "../../transaction-builder/src/sdk-launch-cli.ts";
import { commitRewardsActivation, commitRewardsDeactivation } from "../../transaction-builder/src/sdk-activate-cli.ts";
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
    await db`
      update sdk_parent_config
      set launches_active = true, child_fees_active = true
      where id = 1 and mint_address = ${CANONICAL}
    `;
    const parent = await db<{ id: string }[]>`
      select id::text from parent_registrations where scope = 'production' and symbol = 'SDK'
    `;
    const parentId = parent[0]?.id;
    assert.ok(parentId);
    await db`
      insert into reward_liabilities (
        parent_registration_id, parent_mint_address, scope, kind, amount, asset, status
      ) values (
        ${parentId}, ${CANONICAL}, 'production', 'holder_sol', '2500', 'sol', 'claimable'
      )
    `;
    await db`
      insert into reward_claims (
        liability_id, parent_mint_address, scope, claimant, signature, status, idempotency_key
      )
      select id, ${CANONICAL}, 'production', ${DEPLOYER}, ${SIGNATURE}, 'confirmed', 'claim-confirmed-0001'
      from reward_liabilities
      where parent_mint_address = ${CANONICAL} and scope = 'production'
    `;
    const uncertain = "7".repeat(88);
    await db`
      insert into reward_intents (
        parent_registration_id, parent_mint_address, scope, kind, idempotency_key, status, signature, amount_lamports
      ) values
        (${parentId}, ${CANONICAL}, 'production', 'collect', 'collect-submitted-01', 'submitted', ${SIGNATURE}, 2500),
        (${parentId}, ${CANONICAL}, 'production', 'collect', 'collect-uncertain-001', 'uncertain', ${uncertain}, 2500)
    `;
    assert.equal(await commitRewardsDeactivation(db, OTHER), "blocked");
    assert.equal(await commitRewardsDeactivation(db, CANONICAL), "ok");
    assert.equal(await commitRewardsDeactivation(db, CANONICAL), "idempotent");
    const preserved = await db<{
      rewards: boolean;
      launches: boolean;
      childFees: boolean;
      mint: string;
      liability: string;
      claim: string;
      intents: string;
    }[]>`
      select
        rewards_active as rewards,
        launches_active as launches,
        child_fees_active as "childFees",
        mint_address as mint,
        (select amount from reward_liabilities where scope = 'production') as liability,
        (select status from reward_claims where scope = 'production') as claim,
        (select count(*) from reward_intents where scope = 'production')::text as intents
      from sdk_parent_config
      where id = 1
    `;
    assert.equal(preserved[0]?.rewards, false);
    assert.equal(preserved[0]?.launches, true);
    assert.equal(preserved[0]?.childFees, true);
    assert.equal(preserved[0]?.mint, CANONICAL);
    assert.equal(preserved[0]?.liability, "2500");
    assert.equal(preserved[0]?.claim, "confirmed");
    assert.equal(preserved[0]?.intents, "2");
    await db`update sdk_parent_config set rewards_active = true where id = 1 and mint_address = ${CANONICAL}`;
    const raced = await Promise.all([
      commitRewardsActivation(db, CANONICAL),
      commitRewardsDeactivation(db, CANONICAL),
    ]);
    assert.equal(raced.every((item) => item === "ok" || item === "idempotent"), true);
    await db`
      update sdk_parent_config
      set rewards_active = true, child_fees_active = false
      where id = 1 and mint_address = ${CANONICAL}
    `;
    const independent = await Promise.all([
      commitChildFees(db, CANONICAL),
      commitRewardsDeactivation(db, CANONICAL),
    ]);
    assert.equal(independent.every((item) => item === "ok" || item === "idempotent"), true);
    const settled = await db<{
      rewards: boolean;
      launches: boolean;
      childFees: boolean;
      mint: string;
      liability: string;
      claim: string;
      submitted: string;
      uncertainIntent: string;
    }[]>`
      select
        rewards_active as rewards,
        launches_active as launches,
        child_fees_active as "childFees",
        mint_address as mint,
        (select amount from reward_liabilities where scope = 'production') as liability,
        (select status from reward_claims where scope = 'production') as claim,
        (select status from reward_intents where idempotency_key = 'collect-submitted-01') as submitted,
        (select status from reward_intents where idempotency_key = 'collect-uncertain-001') as "uncertainIntent"
      from sdk_parent_config
      where id = 1
    `;
    assert.equal(settled[0]?.rewards, false);
    assert.equal(settled[0]?.launches, true);
    assert.equal(settled[0]?.childFees, true);
    assert.equal(settled[0]?.mint, CANONICAL);
    assert.equal(settled[0]?.liability, "2500");
    assert.equal(settled[0]?.claim, "confirmed");
    assert.equal(settled[0]?.submitted, "submitted");
    assert.equal(settled[0]?.uncertainIntent, "uncertain");
    assert.equal(after[0]?.trest, TREST);
    assert.equal(after[0]?.amount, "1000");
  } finally {
    await sql?.end({ timeout: 5 });
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
