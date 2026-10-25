import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { createSql } from "./postgres.ts";

const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const HASH = "ab".repeat(32);
const HISTORICAL = "3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF";
const WINDOW = 300_000;
const START = Date.UTC(2026, 9, 24, 12, 0, 0);
const OBSOLETE = "20261022013000_trest07l_continuous_windows.sql";
const DAY = "20261024120000_trest08b_day_rehearsal.sql";
const LATEST = "20261025140000_library_sdk_votes.sql";

let database: EmbeddedPostgres | null = null;
let directory = "";
let sql: ReturnType<typeof createSql> | null = null;

function db() {
  if (!sql) throw new Error("database");
  return sql;
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index * WINDOW);
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sdk-trest08c-"));
  database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55438,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await database.initialise();
  await database.start();
  await database.createDatabase("rewards");
  sql = createSql("postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55438/rewards");
  await db().unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      name text,
      public boolean,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
  `);
  const migrationDir = path.resolve(import.meta.dirname, "../../../supabase/migrations");
  const present = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
  const deployed = present.filter((file) => file !== OBSOLETE);
  assert.equal(deployed.includes(OBSOLETE), false);
  assert.equal(deployed.includes(DAY), true);
  assert.equal(deployed.at(-1), LATEST);
  for (const file of deployed) await db().unsafe(await readFile(path.join(migrationDir, file), "utf8"));
});

after(async () => {
  await sql?.end({ timeout: 5 });
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("TREST-08B applies on the deployed schema without the 07L migration", async () => {
  const empty = await db()<{ collections: number; recoveries: number; liabilities: number; rehearsals: number; controls: number }[]>`
    select
      (select count(*)::int from reward_collections) as collections,
      (select count(*)::int from reward_collection_recoveries) as recoveries,
      (select count(*)::int from reward_liabilities) as liabilities,
      (select count(*)::int from reward_rehearsals) as rehearsals,
      (select count(*)::int from reward_controls) as controls
  `;
  assert.deepEqual(empty[0], { collections: 0, recoveries: 0, liabilities: 0, rehearsals: 0, controls: 0 });

  const definition = await db()<{ windows: string; outcome: string }[]>`
    select
      pg_get_constraintdef(windows.oid) as windows,
      pg_get_constraintdef(outcome.oid) as outcome
    from pg_constraint windows, pg_constraint outcome
    where windows.conname = 'reward_rehearsals_windows_check'
      and outcome.conname = 'reward_rehearsal_windows_outcome_check'
  `;
  assert.match(definition[0]?.windows ?? "", /reward_rehearsal_starts_valid/);
  assert.match(definition[0]?.outcome ?? "", /skipped/);

  const admit = await db()<{ body: string }[]>`
    select pg_get_functiondef('public.reward_rehearsals_admit()'::regprocedure) as body
  `;
  assert.match(admit[0]?.body ?? "", /allocation_deferred = false/);
  assert.doesNotMatch(admit[0]?.body ?? "", /unsettled liabilities/);
  const anon = await db()<{ allowed: boolean }[]>`
    select has_function_privilege('anon', 'public.reward_rehearsal_starts_valid(bigint[])', 'execute') as allowed
  `;
  assert.equal(anon[0]?.allowed, false);

  const accepted = await db()<{ three: boolean; six: boolean; day: boolean; short: boolean; long: boolean; gap: boolean }[]>`
    select
      public.reward_rehearsal_starts_valid(${range(START, 3)}::bigint[]) as three,
      public.reward_rehearsal_starts_valid(${range(START, 6)}::bigint[]) as six,
      public.reward_rehearsal_starts_valid(${range(START, 288)}::bigint[]) as day,
      public.reward_rehearsal_starts_valid(${range(START, 287)}::bigint[]) as short,
      public.reward_rehearsal_starts_valid(${range(START, 289)}::bigint[]) as long,
      public.reward_rehearsal_starts_valid(${[START, START + WINDOW, START + WINDOW * 3]}::bigint[]) as gap
  `;
  assert.deepEqual(accepted[0], { three: true, six: true, day: true, short: false, long: false, gap: false });

  await db()`
    insert into parent_registrations (
      scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
      token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
      verified_at, registered_by, evidence_hash
    ) values (
      'test', 'TREST', ${TREST}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 6, false,
      '11111111111111111111111111111111', true, 'verified', now(), ${DEPLOYER}, ${HASH}
    )
  `;
  await assert.rejects(
    () => db()`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (${TREST}, 'test', 'open', ${range(START, 289)}::bigint[], 1)
    `,
    /reward_rehearsals_windows_check/,
  );
  await db()`
    insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
    values (${TREST}, 'test', 'open', ${range(START, 3)}::bigint[], 1)
  `;
  const rehearsal = await db()<{ id: string }[]>`
    select id::text as id from reward_rehearsals where generation = 1
  `;
  const rehearsalId = rehearsal[0]?.id;
  assert.ok(rehearsalId);
  await db()`
    insert into reward_rehearsal_windows (rehearsal_id, window_start_ms, outcome)
    values (${rehearsalId}::uuid, ${START}, 'claimed')
  `;
  await db()`
    update reward_rehearsal_windows set outcome = 'skipped'
    where rehearsal_id = ${rehearsalId}::uuid and window_start_ms = ${START}
  `;
  await db()`
    update reward_rehearsals set status = 'closed', closed_at = now() where generation = 1
  `;
  await assert.rejects(
    () => db()`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (${TREST}, 'test', 'open', ${range(START, 3)}::bigint[], 2)
    `,
    /overlaps another generation/,
  );

  const parent = await db()<{ id: string }[]>`select id::text as id from parent_registrations where mint_address = ${TREST}`;
  const parentId = parent[0]?.id;
  assert.ok(parentId);
  await db()`
    insert into reward_collections (
      parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot,
      source, status, credited, confirmed_at, gross_lamports, network_fee_lamports, net_lamports,
      allocation_deferred
    ) values (
      ${parentId}::uuid, ${TREST}, 'test', ${HISTORICAL}, 85140307, 459711211,
      'creator_vault', 'confirmed', true, now(), 85145307, 5000, 85140307, true
    )
  `;
  await db()`
    insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
    values (${TREST}, 'test', 'open', ${range(START + 3 * WINDOW, 6)}::bigint[], 2)
  `;
  await db()`
    update reward_rehearsals set status = 'closed', closed_at = now() where generation = 2
  `;
  await db()`
    insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
    values (${TREST}, 'test', 'open', ${range(START + 9 * WINDOW, 288)}::bigint[], 3)
  `;
  await db()`
    update reward_rehearsals set status = 'closed', closed_at = now() where generation = 3
  `;
  await db()`
    insert into reward_collections (
      parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot,
      source, status, credited, confirmed_at, gross_lamports, network_fee_lamports, net_lamports,
      allocation_deferred
    ) values (
      ${parentId}::uuid, ${TREST}, 'test', ${"4".repeat(88)}, 1000, 2,
      'creator_vault', 'confirmed', true, now(), 1000, 0, 1000, false
    )
  `;
  await assert.rejects(
    () => db()`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (${TREST}, 'test', 'open', ${range(START + 297 * WINDOW, 3)}::bigint[], 4)
    `,
    /unresolved financial state/,
  );

  const historical = await db()<{ deferred: boolean; allocated: Date | null; net: string }[]>`
    select allocation_deferred as deferred, allocated_at as allocated, net_lamports::text as net
    from reward_collections where signature = ${HISTORICAL}
  `;
  assert.equal(historical[0]?.deferred, true);
  assert.equal(historical[0]?.allocated, null);
  assert.equal(historical[0]?.net, "85140307");
  const controls = await db()<{ suspended: boolean | null }[]>`
    select bool_and(signer_suspended) as suspended from reward_controls
  `;
  assert.equal(controls[0]?.suspended, null);
  const liabilities = await db()<{ count: number }[]>`select count(*)::int as count from reward_liabilities`;
  assert.equal(liabilities[0]?.count, 0);
});
