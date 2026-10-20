import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { createSql, postgresRewardsStore } from "./postgres.ts";

const MINT = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const PRODUCTION_MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const DEPLOYER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const HOLDER = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const SIGNATURE = "2".repeat(88);
const HASH = "ab".repeat(32);
const START = Date.UTC(2026, 9, 20, 16, 0, 0);

let database: EmbeddedPostgres | null = null;
let directory = "";
let sql: ReturnType<typeof createSql> | null = null;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sdk-rewards-"));
  database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55432,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await database.initialise();
  await database.start();
  await database.createDatabase("rewards");
  const url = new URL("postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55432/rewards");
  assert.equal(url.hostname, "127.0.0.1");
  assert.notEqual(url.toString(), process.env.DATABASE_URL);
  sql = createSql(url.toString());
  await sql.unsafe(`
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
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(files.slice(-7), [
    "20261020140000_phase_05d1_signing_attempt.sql",
    "20261020180000_trest01_parent_registration.sql",
    "20261020200000_trest02_reward_execution.sql",
    "20261020220000_trest03_reward_worker.sql",
    "20261020230000_trest031_reward_claim_status.sql",
    "20261020240000_phase_05d2_launch_submission.sql",
    "20261020250000_phase_05d2b_launch_approval.sql",
  ]);
  for (const file of files) {
    await sql.unsafe(await readFile(path.join(migrationDir, file), "utf8"));
  }
});

after(async () => {
  await sql?.end({ timeout: 5 });
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function db() {
  if (!sql) throw new Error("database");
  return sql;
}

async function register(scope: "test" | "production", mint: string) {
  await db()`
    insert into parent_registrations (
      scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
      token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
      verified_at, registered_by, evidence_hash
    ) values (
      ${scope}, ${scope === "test" ? "TREST" : "SDK"}, ${mint}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 6, false,
      '11111111111111111111111111111111', true, 'verified', now(), ${DEPLOYER}, ${HASH}
    )
  `;
  await db()`
    insert into reward_controls (
      parent_registration_id, parent_mint_address, scope, signer_suspended, reserve_lamports, cycle_cap_lamports, slippage_bps
    )
    select id, ${mint}, ${scope}, true, 0, 1000000000, 100
    from parent_registrations
    where mint_address = ${mint}
  `;
}

test("the rewards schema applies on an isolated database and enforces recovery invariants", async () => {
  const store = postgresRewardsStore(db());
  await register("test", MINT);
  await register("production", PRODUCTION_MINT);
  await assert.rejects(() => register("production", "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"));
  const testParent = await store.parent("test");
  const productionParent = await store.parent("production");
  assert.equal(testParent?.mintAddress, MINT);
  assert.equal(productionParent?.mintAddress, PRODUCTION_MINT);
  assert.equal(testParent?.symbol, "TREST");
  await assert.rejects(() => db()`update parent_registrations set symbol = 'SDK' where mint_address = ${MINT}`);

  const windowKey = `test:${MINT}:${START}`;
  assert.equal(await store.saveWindow({
    parentMint: MINT,
    scope: "test",
    windowKey,
    collected: "1000",
    holders: "300",
    buyback: "300",
    deployer: "400",
  }), "ok");
  assert.equal((await store.windows(MINT, "test"))[0]?.windowKey, windowKey);
  assert.equal(await store.saveWindow({
    parentMint: MINT,
    scope: "test",
    windowKey,
    collected: "1000",
    holders: "300",
    buyback: "300",
    deployer: "400",
  }), "duplicate");
  await assert.rejects(() => db()`
    insert into reward_windows (
      parent_registration_id, parent_mint_address, scope, window_start, window_end,
      collected_lamports, holder_lamports, buyback_lamports, deployer_retained_lamports, status
    )
    select id, ${MINT}, 'test', to_timestamp(${START + 300_000} / 1000.0), to_timestamp(${START + 600_000} / 1000.0),
      100, 10, 10, 10, 'allocated'
    from parent_registrations where mint_address = ${MINT}
  `);
  const liabilities = await db()`
    select kind, amount from reward_liabilities
    where parent_mint_address = ${MINT} and window_id is not null
    order by kind
  `;
  assert.deepEqual(liabilities.map((row) => `${row.kind}:${row.amount}`), ["buyback_sol:300", "deployer_retained:400", "holder_sol:300"]);

  assert.equal(await store.saveSnapshots(MINT, "test", windowKey, [{
    owner: HOLDER,
    balance: "60000000000",
    solLamports: "300",
    tokenAmount: "0",
    cutoffSlot: "44",
  }]), "ok");
  assert.equal((await store.snapshots(MINT, "test", windowKey))[0]?.cutoffSlot, "44");

  const claim = {
    claimant: HOLDER,
    asset: "sol" as const,
    amount: "300",
    idempotencyKey: "claim-sol-holder-0001",
    status: "recorded" as const,
    signature: null,
    scope: "test" as const,
    parentMint: MINT,
    proofHash: HASH,
  };
  assert.equal(await store.saveClaim(claim), "ok");
  assert.equal(await store.saveClaim(claim), "duplicate");
  assert.equal(await store.saveClaim({ ...claim, amount: "1", idempotencyKey: "claim-sol-holder-0002" }), "amount");
  assert.equal(await store.markClaim(MINT, "test", claim.idempotencyKey, "failed", SIGNATURE), "ok");
  assert.equal(await store.saveClaim({ ...claim, idempotencyKey: "claim-sol-holder-0003" }), "ok");
  assert.equal(await store.markClaim(MINT, "test", "claim-sol-holder-0003", "uncertain", SIGNATURE.replace("2", "3")), "ok");
  assert.equal(await store.saveClaim({ ...claim, amount: "1", idempotencyKey: "claim-sol-holder-0004" }), "uncertain");
  const claims = await store.claims(MINT, "test");
  assert.equal(claims.find((row) => row.idempotencyKey === "claim-sol-holder-0003")?.status, "uncertain");
  assert.equal(claims.find((row) => row.idempotencyKey === "claim-sol-holder-0003")?.amount, "300");
  assert.equal(await store.markClaim(MINT, "test", "claim-sol-holder-0003", "confirmed", null), "ok");
  assert.equal(await store.markClaim(MINT, "test", "claim-sol-holder-0003", "failed", null), "order");

  assert.equal(await store.recordIntent({
    idempotencyKey: "collect-window-000001",
    parentMint: MINT,
    scope: "test",
    kind: "collect",
    amountLamports: "1000",
    tokenAmount: null,
    messageSha256: null,
  }), "ok");
  assert.equal(await store.markIntent(MINT, "test", "collect-window-000001", "submitted", SIGNATURE.replaceAll("2", "4")), "ok");
  assert.equal(await store.recordIntent({
    idempotencyKey: "collect-window-000001",
    parentMint: MINT,
    scope: "test",
    kind: "collect",
    amountLamports: "1000",
    tokenAmount: null,
    messageSha256: null,
  }), "duplicate");
  const intents = await store.intents(MINT, "test");
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.signature, SIGNATURE.replaceAll("2", "4"));
  assert.equal(await store.markIntent(MINT, "test", "collect-window-000001", "uncertain", null), "ok");
  await assert.rejects(() => db()`update reward_intents set kind = 'buyback' where idempotency_key = 'collect-window-000001'`);

  const now = Date.now();
  assert.equal(await store.tryLock(MINT, "test", "worker-a", now), "ok");
  assert.equal(await store.tryLock(MINT, "test", "worker-b", now), "locked");
  await db()`update reward_cycle_locks set expires_at = to_timestamp(0) where holder = 'worker-a'`;
  assert.equal(await store.tryLock(MINT, "test", "worker-b", START + 1), "ok");

  assert.equal(await store.saveReceipt({
    signature: SIGNATURE.replaceAll("2", "5"),
    parentMint: MINT,
    scope: "test",
    amountLamports: "1000",
    slot: "44",
    confirmed: true,
    source: "creator_vault",
    gross: "1000",
    fee: "0",
    native: "1000",
    wsolConverted: "0",
    rentExcluded: "0",
  }), "ok");
  assert.equal((await store.receipts(MINT, "test"))[0]?.amountLamports, "1000");
  assert.equal((await store.receipts(PRODUCTION_MINT, "production")).length, 0);

  const attemptStatus = await db()`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.token_launches'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%attempt_status%'
  `;
  assert.equal(String(attemptStatus[0]?.definition).includes("uncertain"), true);
  assert.equal(String(attemptStatus[0]?.definition).includes("verified"), true);
  const submissionLock = await db()`
    select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_class c
    where c.oid = 'public.launch_submissions'::regclass
  `;
  assert.equal(submissionLock[0]?.enabled, true);
  assert.equal(submissionLock[0]?.forced, true);
  const parentConfig = await db()`select mint_address from sdk_parent_config where id = 1`;
  assert.equal(parentConfig.length, 0);

  try {
    await db()`set role anon`;
    await assert.rejects(() => db()`select id from parent_registrations`);
    await assert.rejects(() => db()`select id from launch_submissions`);
    await assert.rejects(() => db()`select id from launch_approvals`);
  } finally {
    await db()`reset role`;
  }
});
