import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { windowKey as rewardWindowKey } from "../../../lib/rewards/cycle.ts";
import { ensureTestParentControls } from "../../../lib/rewards/ensure-controls.ts";
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
let databaseUrl = "";
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
  databaseUrl = url.toString();
  sql = createSql(databaseUrl);
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
  const files = (await readdir(migrationDir))
    .filter((file) => file.endsWith(".sql") && file !== "20261022013000_trest07l_continuous_windows.sql" && file !== "20261026190000_sdk_prod_01a_canonical_parent.sql")
    .sort();
  assert.deepEqual(files.slice(-13), [
    "20261020200000_trest02_reward_execution.sql",
    "20261020220000_trest03_reward_worker.sql",
    "20261020230000_trest031_reward_claim_status.sql",
    "20261020240000_phase_05d2_launch_submission.sql",
    "20261020250000_phase_05d2b_launch_approval.sql",
    "20261020260000_trest04_claims_child_fees_emergency.sql",
    "20261021100000_trest04d_window_allocation.sql",
    "20261021140000_trest07e_collection_diagnostics.sql",
    "20261021160000_trest07f_legacy_recovery.sql",
    "20261021180000_trest07i_rehearsal_windows.sql",
    "20261021190000_trest07j_confirmation_recovery.sql",
    "20261024120000_trest08b_day_rehearsal.sql",
    "20261025140000_library_sdk_votes.sql",
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
  const obligations = await store.solObligations(MINT, "test");
  assert.equal(obligations.holderSol, "300");
  assert.equal(obligations.confirmedHolderSol, "300");
  const liabilityRows = await db()`
    select count(*)::int as count from reward_liabilities
    where parent_mint_address = ${MINT} and kind = 'holder_sol'
  `;
  assert.equal(liabilityRows[0]?.count, 3);

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
  const blockhash = "2".repeat(43);
  assert.equal(await store.recordSubmission(MINT, "test", "collect-window-000001", {
    recentBlockhash: blockhash,
    submissionCode: "rpc:-32002",
    submissionDetail: "Transaction simulation failed",
  }), "ok");
  assert.equal(await store.markIntent(MINT, "test", "collect-window-000001", "unreconciled", null), "ok");
  assert.equal(await store.markIntent(MINT, "test", "collect-window-000001", "confirmed", null), "ok");
  const diagnosed = await store.intents(MINT, "test");
  assert.equal(diagnosed[0]?.status, "confirmed");
  assert.equal(diagnosed[0]?.recentBlockhash, blockhash);
  assert.equal(diagnosed[0]?.submissionCode, "rpc:-32002");
  assert.equal(diagnosed[0]?.signature, SIGNATURE.replaceAll("2", "4"));
  await assert.rejects(() => db()`update reward_intents set kind = 'buyback' where idempotency_key = 'collect-window-000001'`);
  const legacyEvidence = {
    signatureState: "absent" as const,
    transaction: "absent" as const,
    currentSlot: "459645473",
    submissionSlot: "459637647",
    slotsElapsed: "7826",
    blockhashSlots: "150" as const,
    createdAtMs: "1792587543925",
    deployerLamports: "280727692",
    vaultLamports: "84559054",
  };
  const legacy = await store.saveLegacyRecovery({
    parentMint: "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump",
    scope: "test",
    idempotencyKey: "collect-1792587300000",
    signature: "3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m",
    priorStatus: "uncertain",
    operatorId: "operator-1",
    approval: "TREST-07F-LEGACY-RECOVERY",
    reason: "blockhash window elapsed and signature absent",
    evidence: legacyEvidence,
  });
  assert.equal(legacy.ok, true);
  assert.equal((await store.saveLegacyRecovery({
    parentMint: "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump",
    scope: "test",
    idempotencyKey: "collect-1792587300000",
    signature: "3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m",
    priorStatus: "uncertain",
    operatorId: "operator-1",
    approval: "TREST-07F-LEGACY-RECOVERY",
    reason: "again",
    evidence: legacyEvidence,
  })).ok, false);
  assert.equal((await store.saveLegacyRecovery({
    parentMint: MINT,
    scope: "test",
    idempotencyKey: "collect-window-000001",
    signature: SIGNATURE,
    priorStatus: "uncertain",
    operatorId: "operator-1",
    approval: "TREST-07F-LEGACY-RECOVERY",
    reason: "wrong intent",
    evidence: legacyEvidence,
  })).ok, false);
  const savedRecovery = (await store.legacyRecoveries("BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump", "test"))[0];
  assert.equal(savedRecovery?.evidence.slotsElapsed, "7826");
  assert.equal(savedRecovery?.priorStatus, "uncertain");
  await assert.rejects(() => db()`update reward_legacy_recoveries set reason = 'changed'`);
  await assert.rejects(() => db()`delete from reward_legacy_recoveries`);

  const rehearsalMint = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
  const rehearsalStarts = [START, START + 300_000, START + 600_000];
  assert.equal(await store.registerRehearsal({
    parentMint: MINT,
    scope: "test",
    windowStartsMs: rehearsalStarts,
    requireUpcoming: false,
  }), "rejected");
  assert.equal(await store.registerRehearsal({
    parentMint: rehearsalMint,
    scope: "test",
    windowStartsMs: [START, START + 300_000, START + 900_000],
    requireUpcoming: false,
  }), "rejected");
  assert.equal(await store.registerRehearsal({
    parentMint: rehearsalMint,
    scope: "test",
    windowStartsMs: rehearsalStarts,
    nowMs: START,
    requireUpcoming: true,
  }), "rejected");
  assert.equal(await store.rehearsalState(rehearsalMint, "test"), null);
  assert.equal(await store.registerRehearsal({
    parentMint: rehearsalMint,
    scope: "test",
    windowStartsMs: rehearsalStarts,
    requireUpcoming: false,
  }), "ok");
  assert.equal(await store.registerRehearsal({
    parentMint: rehearsalMint,
    scope: "test",
    windowStartsMs: rehearsalStarts,
    requireUpcoming: false,
  }), "duplicate");
  assert.equal((await store.claimRehearsalWindow({
    parentMint: rehearsalMint,
    scope: "test",
    windowStartMs: START - 300_000,
  })).ok, false);
  assert.equal((await store.rehearsalState(rehearsalMint, "test"))?.processed.length, 0);
  assert.equal(await store.rehearsalBlocksSideWork(rehearsalMint, "test"), true);
  assert.equal(await store.rehearsalBlocksSideWork(MINT, "test"), false);
  for (const windowStartMs of rehearsalStarts) {
    const admission = await store.claimRehearsalWindow({ parentMint: rehearsalMint, scope: "test", windowStartMs });
    assert.equal(admission.ok, true);
    if (!admission.ok) return;
    assert.equal(admission.admission, "execute");
    const repeated = await store.claimRehearsalWindow({ parentMint: rehearsalMint, scope: "test", windowStartMs });
    assert.equal(repeated.ok, false);
    if (repeated.ok) return;
    assert.equal(repeated.code, "claimed");
    assert.equal((await store.rehearsalState(rehearsalMint, "test"))?.status, "open");
    assert.equal(await store.finishRehearsalWindow({
      parentMint: rehearsalMint,
      scope: "test",
      windowStartMs,
      outcome: "ok",
    }), "ok");
  }
  const closed = await store.rehearsalState(rehearsalMint, "test");
  assert.equal(closed?.status, "closed");
  assert.equal(closed?.processed.length, 3);
  assert.equal(closed?.blocksSideWork, true);
  const afterClose = await store.claimRehearsalWindow({ parentMint: rehearsalMint, scope: "test", windowStartMs: START });
  assert.equal(afterClose.ok, false);
  if (afterClose.ok) return;
  assert.equal(afterClose.code, "closed");
  await assert.rejects(() => db()`
    insert into reward_rehearsal_windows (rehearsal_id, window_start_ms, outcome)
    select id, ${START + 900_000}, 'claimed' from reward_rehearsals
  `);
  await assert.rejects(() => db()`update reward_rehearsals set status = 'open'`);
  await assert.rejects(() => db()`delete from reward_rehearsal_windows`);
  await assert.rejects(() => db()`delete from reward_rehearsals`);
  await assert.rejects(() => db()`update reward_rehearsals set generation = 2`);
  const rehearsalMintAddress = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
  const blockingSignature = "3".repeat(88);
  await assert.rejects(() => db().begin(async (tx) => {
    await tx`
      insert into reward_intents (
        parent_registration_id, parent_mint_address, scope, kind, idempotency_key, status, signature, amount_lamports
      )
      select id, ${rehearsalMintAddress}, 'test', 'collect', 'collect-unresolved-gen2', 'uncertain', ${blockingSignature}, 0
      from parent_registrations
      where mint_address = ${MINT}
    `;
    await tx`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (
        ${rehearsalMintAddress}, 'test', 'open',
        array[${START + 900_000}::bigint, ${START + 1_200_000}::bigint, ${START + 1_500_000}::bigint],
        2
      )
    `;
  }));
  await assert.rejects(() => db().begin(async (tx) => {
    await tx`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (
        ${rehearsalMintAddress}, 'test', 'open',
        array[${START}::bigint, ${START + 300_000}::bigint, ${START + 600_000}::bigint],
        2
      )
    `;
    await tx`
      insert into reward_rehearsal_windows (rehearsal_id, window_start_ms, outcome)
      select id, ${START}, 'claimed'
      from reward_rehearsals
      where generation = 2
    `;
  }));
  await assert.rejects(() => db().begin(async (tx) => {
    await tx`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (
        ${rehearsalMintAddress}, 'test', 'open',
        array[${START + 900_000}::bigint, ${START + 1_200_000}::bigint, ${START + 1_500_000}::bigint],
        2
      )
    `;
    await tx`
      insert into reward_rehearsals (parent_mint_address, scope, status, window_start_ms, generation)
      values (
        ${rehearsalMintAddress}, 'test', 'open',
        array[${START + 1_800_000}::bigint, ${START + 2_100_000}::bigint, ${START + 2_400_000}::bigint],
        3
      )
    `;
  }));
  await assert.rejects(() => db().begin(async (tx) => {
    await tx`
      insert into reward_collection_recoveries (
        parent_mint_address, scope, idempotency_key, signature, prior_status, approval, operator_label, reason,
        gross_lamports, fee_lamports, net_lamports, reserve_withheld_lamports, holder_lamports, buyback_lamports,
        deployer_lamports, snapshot_status
      ) values (
        ${rehearsalMintAddress}, 'test', 'collect-1792603200000',
        '3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF',
        'uncertain', 'TREST-07J-COLLECTION-RECOVERY', 'trest-07j', 'confirmed collection had no receipt',
        85145307, 5000, 85140307, 5000000, 24042092, 24042092, 32056123, 'historical_unavailable'
      )
    `;
    await tx`update reward_collection_recoveries set reason = 'changed'`;
  }));
  await assert.rejects(() => db().begin(async (tx) => {
    await tx`
      insert into reward_collection_recoveries (
        parent_mint_address, scope, idempotency_key, signature, prior_status, approval, operator_label, reason,
        gross_lamports, fee_lamports, net_lamports, reserve_withheld_lamports, holder_lamports, buyback_lamports,
        deployer_lamports, snapshot_status
      ) values (
        ${rehearsalMintAddress}, 'test', 'collect-1792603200000',
        '3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF',
        'uncertain', 'TREST-07J-COLLECTION-RECOVERY', 'trest-07j', 'confirmed collection had no receipt',
        85145307, 5000, 1, 5000000, 24042092, 24042092, 32056123, 'historical_unavailable'
      )
    `;
  }));
  const lockedSignature = "3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF";
  await db()`
    insert into reward_intents (
      parent_registration_id, parent_mint_address, scope, kind, idempotency_key, status, signature, amount_lamports
    )
    select id, ${rehearsalMintAddress}, 'test', 'collect', 'collect-1792603200000', 'uncertain', ${lockedSignature}, 0
    from parent_registrations
    where mint_address = ${MINT}
  `;
  assert.equal(await store.commitCollectionRecovery({
    parentMint: rehearsalMintAddress,
    scope: "test",
    idempotencyKey: "collect-1792603200000",
    signature: lockedSignature,
    priorStatus: "uncertain",
    approval: "TREST-07J-COLLECTION-RECOVERY",
    operator: "trest-07j",
    reason: "confirmed collection had no receipt",
    grossLamports: "85145307",
    feeLamports: "5000",
    netLamports: "85140307",
    reserveLamports: "5000000",
    holderLamports: "24042092",
    buybackLamports: "24042092",
    deployerLamports: "32056123",
    snapshotStatus: "historical_unavailable",
    gross: "85145307",
    fee: "5000",
    native: "85140307",
    wsolConverted: "0",
    rentExcluded: "0",
    slot: "459711211",
    amountLamports: "85140307",
  }), "rejected");
  const rolledRecovery = await db()`
    select
      (select count(*)::int from reward_collection_recoveries) as audits,
      (select count(*)::int from reward_collections where signature = ${lockedSignature}) as receipts,
      (select status from reward_intents where idempotency_key = 'collect-1792603200000') as status
  `;
  assert.equal(Number(rolledRecovery[0]?.audits), 0);
  assert.equal(Number(rolledRecovery[0]?.receipts), 0);
  assert.equal(rolledRecovery[0]?.status, "uncertain");
  assert.equal((await db()`select count(*)::int as n from reward_rehearsals where generation = 2`)[0]?.n, 0);
  assert.equal((await db()`select count(*)::int as n from reward_collection_recoveries`)[0]?.n, 0);
  const controls = await db()`
    select parent_mint_address, signer_suspended
    from reward_controls
    order by parent_mint_address
  `;
  assert.equal(controls.length, 2);
  assert.equal(controls.every((row) => row.signer_suspended === true), true);

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
  const trest04 = await db()`
    select to_regclass('public.reward_claim_challenges') as challenges,
           to_regclass('public.child_fee_distributions') as distributions,
           to_regclass('public.child_fee_receipts') as receipts,
           to_regclass('public.emergency_sweeps') as sweeps
  `;
  assert.ok(trest04[0]?.challenges);
  assert.ok(trest04[0]?.distributions);
  assert.ok(trest04[0]?.receipts);
  assert.ok(trest04[0]?.sweeps);
  await db()`
    insert into reward_claim_challenges (
      wallet_address, parent_mint_address, scope, asset, nonce, amount, domain, expires_at
    ) values (
      ${HOLDER}, ${MINT}, 'test', 'sol', 'challenge-nonce-01', '10', 'sdk.fund', now() + interval '10 minutes'
    )
  `;
  await assert.rejects(() => db()`
    insert into reward_claim_challenges (
      wallet_address, parent_mint_address, scope, asset, nonce, amount, domain, expires_at
    ) values (
      ${HOLDER}, ${MINT}, 'test', 'sol', 'challenge-nonce-01', '11', 'sdk.fund', now() + interval '10 minutes'
    )
  `);
  const raced = await Promise.allSettled([
    db()`
      insert into reward_claim_challenges (
        wallet_address, parent_mint_address, scope, asset, nonce, amount, domain, expires_at
      ) values (
        ${HOLDER}, ${MINT}, 'test', 'parent_token', 'challenge-nonce-02', '4', 'sdk.fund', now() + interval '10 minutes'
      )
    `,
    db()`
      insert into reward_claim_challenges (
        wallet_address, parent_mint_address, scope, asset, nonce, amount, domain, expires_at
      ) values (
        ${HOLDER}, ${MINT}, 'test', 'parent_token', 'challenge-nonce-02', '4', 'sdk.fund', now() + interval '10 minutes'
      )
    `,
  ]);
  assert.equal(raced.filter((row) => row.status === "fulfilled").length, 1);
  await db()`
    insert into child_fee_distributions (
      idempotency_key, child_mint_address, quote_mint_address, scope, status, signature
    ) values (
      'child-built-0000001', ${MINT}, ${PRODUCTION_MINT}, 'test', 'submitted', ${SIGNATURE}
    )
  `;
  const built = await db()`
    select count(*)::int as count
    from child_fee_receipts r
    join child_fee_distributions d on d.id = r.distribution_id
    where d.idempotency_key = 'child-built-0000001'
  `;
  assert.equal(Number(built[0]?.count), 0);
  await assert.rejects(() => db()`
    insert into child_fee_distributions (
      idempotency_key, child_mint_address, quote_mint_address, scope, status, signature
    ) values (
      'child-confirmed-nosig', ${MINT}, ${PRODUCTION_MINT}, 'test', 'confirmed', null
    )
  `);
  await assert.rejects(() => db()`
    insert into emergency_sweeps (
      parent_mint_address, scope, destination_address, signer_address, mode, status,
      sol_lamports, token_amount, claimable_sol, claimable_token, shortfall, signature
    ) values (
      ${MINT}, 'test', ${PRODUCTION_MINT}, ${DEPLOYER}, 'execute', 'confirmed',
      '1', '1', '1', '1', true, null
    )
  `);
  await db()`
    insert into emergency_sweeps (
      parent_mint_address, scope, destination_address, signer_address, mode, status,
      sol_lamports, token_amount, claimable_sol, claimable_token, shortfall
    ) values (
      ${MINT}, 'test', ${PRODUCTION_MINT}, ${DEPLOYER}, 'dry_run', 'planned',
      '1', '1', '1', '1', true
    )
  `;

  try {
    await db()`set role anon`;
    await assert.rejects(() => db()`select id from parent_registrations`);
    await assert.rejects(() => db()`select id from launch_submissions`);
    await assert.rejects(() => db()`select id from launch_approvals`);
    await assert.rejects(() => db()`select id from reward_claim_challenges`);
    await assert.rejects(() => db()`select id from emergency_sweeps`);
    await assert.rejects(() => db()`select id from reward_rehearsals`);
    await assert.rejects(() => db()`select rehearsal_id from reward_rehearsal_windows`);
  } finally {
    await db()`reset role`;
  }

  await db()`
    update reward_collections
    set allocated_at = now(),
        reserve_withheld_lamports = 0,
        reward_window_id = (
          select id from reward_windows
          where parent_mint_address = ${MINT} and scope = 'test' and window_start = to_timestamp(${START} / 1000.0)
        )
    where signature = ${SIGNATURE.replaceAll("2", "5")}
  `;
  const fee = (signature: string, amount: string, mint = MINT, scope: "test" | "production" = "test") => store.saveReceipt({
    signature,
    parentMint: mint,
    scope,
    amountLamports: amount,
    slot: "45",
    confirmed: true,
    source: "creator_vault",
    gross: amount,
    fee: "0",
    native: amount,
    wsolConverted: "0",
    rentExcluded: "0",
  });
  const at = (offset: number) => {
    const key = rewardWindowKey(MINT, "test", START + offset + 1);
    if (!key) throw new Error("window");
    return key;
  };
  assert.equal(await fee("3".repeat(88), "1000"), "ok");
  const first = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(600_000), reserveLamports: "0" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state, "allocated");
  if (first.state !== "allocated") return;
  assert.deepEqual([first.holders, first.buyback, first.deployer, first.base], ["500", "0", "500", "1000"]);
  assert.equal(await fee("4".repeat(88), "2000"), "ok");
  const second = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(900_000), reserveLamports: "0" });
  assert.equal(second.ok, true);
  if (!second.ok || second.state !== "allocated") return;
  assert.deepEqual([second.holders, second.buyback, second.deployer], ["1000", "0", "1000"]);
  const beforeEmpty = (await store.windows(MINT, "test")).length;
  const third = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(1_200_000), reserveLamports: "0" });
  assert.deepEqual(third, { ok: true, state: "empty" });
  assert.equal((await store.windows(MINT, "test")).length, beforeEmpty);
  const linked = await db()`
    select signature, reward_window_id::text as window
    from reward_collections
    where signature in (${"3".repeat(88)}, ${"4".repeat(88)})
    order by signature
  `;
  assert.equal(linked.length, 2);
  assert.notEqual(linked[0]?.window, linked[1]?.window);
  assert.equal(await fee("6".repeat(88), "1000"), "ok");
  assert.equal(await fee("7".repeat(88), "2000"), "ok");
  const many = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(1_500_000), reserveLamports: "0" });
  assert.equal(many.ok, true);
  if (!many.ok || many.state !== "allocated") return;
  assert.deepEqual([many.base, many.holders, many.buyback, many.deployer], ["3000", "1500", "0", "1500"]);
  const shared = await db()`
    select count(distinct reward_window_id)::int as windows
    from reward_collections
    where signature in (${"6".repeat(88)}, ${"7".repeat(88)})
  `;
  assert.equal(Number(shared[0]?.windows), 1);
  assert.equal(await fee("8".repeat(88), "5000"), "ok");
  const repeated = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(1_500_000), reserveLamports: "0" });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.state, "duplicate");
  const stillOpen = await db()`
    select count(*)::int as count from reward_collections
    where signature = ${"8".repeat(88)} and allocated_at is null
  `;
  assert.equal(Number(stillOpen[0]?.count), 1);
  const replay = await postgresRewardsStore(db()).allocateUnallocated({
    parentMint: MINT, scope: "test", windowKey: at(1_500_000), reserveLamports: "0",
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.state, "duplicate");
  const carried = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(1_800_000), reserveLamports: "0" });
  assert.equal(carried.ok, true);
  if (!carried.ok || carried.state !== "allocated") return;
  assert.equal(carried.base, "5000");
  assert.equal(await fee("9".repeat(88), "1000"), "ok");
  await db()`
    create function public.trest04d_fail_window() returns trigger language plpgsql as $$
    begin
      raise exception 'allocation persistence failed';
    end $$
  `;
  await db()`
    create trigger trest04d_fail_window before insert on public.reward_windows
    for each row execute function public.trest04d_fail_window()
  `;
  await assert.rejects(() => store.allocateUnallocated({
    parentMint: MINT, scope: "test", windowKey: at(2_100_000), reserveLamports: "0",
  }));
  const rolled = await db()`
    select count(*)::int as count from reward_collections
    where signature = ${"9".repeat(88)} and allocated_at is null
  `;
  assert.equal(Number(rolled[0]?.count), 1);
  await db()`drop trigger trest04d_fail_window on public.reward_windows`;
  await db()`drop function public.trest04d_fail_window()`;
  const retried = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(2_100_000), reserveLamports: "0" });
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.state, "allocated");
  assert.equal(await fee("B".repeat(88), "1000"), "ok");
  assert.equal(await fee("C".repeat(88), "1000"), "ok");
  const left = createSql(databaseUrl);
  const right = createSql(databaseUrl);
  const allocationRace = await Promise.all([
    postgresRewardsStore(left).allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(2_400_000), reserveLamports: "0" }),
    postgresRewardsStore(right).allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(2_400_000), reserveLamports: "0" }),
  ]).finally(async () => {
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
  });
  assert.deepEqual(allocationRace.map((row) => row.ok && row.state).sort(), ["allocated", "duplicate"]);
  const once = await db()`
    select count(*)::int as receipts, count(distinct reward_window_id)::int as windows
    from reward_collections
    where signature in (${"B".repeat(88)}, ${"C".repeat(88)})
  `;
  assert.equal(Number(once[0]?.receipts), 2);
  assert.equal(Number(once[0]?.windows), 1);
  const raceLiabilities = await db()`
    select count(*)::int as count
    from reward_liabilities liability
    join reward_windows window_row on window_row.id = liability.window_id
    where window_row.window_start = to_timestamp(${START + 2_400_000} / 1000.0)
  `;
  assert.equal(Number(raceLiabilities[0]?.count), 3);
  assert.equal(await fee("D".repeat(88), "1000"), "ok");
  const reserved = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(2_700_000), reserveLamports: "4000" });
  assert.deepEqual(reserved, { ok: true, state: "reserved", withheld: "1000" });
  assert.equal(await fee("E".repeat(88), "10000"), "ok");
  const afterReserve = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(3_000_000), reserveLamports: "4000" });
  assert.equal(afterReserve.ok, true);
  if (!afterReserve.ok || afterReserve.state !== "allocated") return;
  assert.equal(afterReserve.withheld, "3000");
  assert.deepEqual([afterReserve.base, afterReserve.holders, afterReserve.buyback, afterReserve.deployer], ["7000", "3500", "0", "3500"]);
  assert.equal(await fee("F".repeat(88), "1000", PRODUCTION_MINT, "production"), "ok");
  const isolated = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(3_300_000), reserveLamports: "0" });
  assert.deepEqual(isolated, { ok: true, state: "empty" });
  const deferredSignature = "3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF";
  await assert.rejects(() => db()`
    insert into reward_collections (
      parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot, source, status,
      credited, confirmed_at, gross_lamports, network_fee_lamports, net_lamports, native_lamports,
      wsol_token_lamports, wsol_converted_lamports, rent_excluded_lamports, allocation_deferred
    )
    select id, ${MINT}, 'test', ${"G".repeat(88)}, 1000, 1, 'creator_vault', 'confirmed', true, now(),
      1000, 0, 1000, 1000, 0, 0, 0, true
    from parent_registrations
    where mint_address = ${MINT}
  `);
  await db()`
    insert into reward_collections (
      parent_registration_id, parent_mint_address, scope, signature, amount_lamports, slot, source, status,
      credited, confirmed_at, gross_lamports, network_fee_lamports, net_lamports, native_lamports,
      wsol_token_lamports, wsol_converted_lamports, rent_excluded_lamports, allocation_deferred
    )
    select id, ${MINT}, 'test', ${deferredSignature}, 85140307, 459711211, 'creator_vault', 'confirmed', true, now(),
      85145307, 5000, 85140307, 85140307, 0, 0, 0, true
    from parent_registrations
    where mint_address = ${MINT}
  `;
  const deferred = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(3_600_000), reserveLamports: "5000000" });
  assert.deepEqual(deferred, { ok: true, state: "empty" });
  const deferredRow = await db()`
    select allocation_deferred, allocated_at from reward_collections where signature = ${deferredSignature}
  `;
  assert.equal(deferredRow[0]?.allocation_deferred, true);
  assert.equal(deferredRow[0]?.allocated_at, null);
  assert.equal(await fee("H".repeat(88), "1000"), "ok");
  const ordinary = await store.allocateUnallocated({ parentMint: MINT, scope: "test", windowKey: at(3_900_000), reserveLamports: "4000" });
  assert.equal(ordinary.ok, true);
  if (!ordinary.ok) return;
  assert.equal(ordinary.state, "allocated");
  if (ordinary.state === "allocated") assert.equal(ordinary.base, "1000");
  const stillDeferred = await db()`select allocated_at from reward_collections where signature = ${deferredSignature}`;
  assert.equal(stillDeferred[0]?.allocated_at, null);
  const productionReceipt = await db()`
    select allocated_at from reward_collections where signature = ${"F".repeat(88)}
  `;
  assert.equal(productionReceipt[0]?.allocated_at, null);
  await db()`delete from reward_controls where parent_mint_address = ${MINT}`;
  assert.equal(await ensureTestParentControls(db(), MINT), "created");
  const created = await db()`
    select signer_suspended, reserve_lamports::text as reserve, cycle_cap_lamports::text as cap, slippage_bps
    from reward_controls where parent_mint_address = ${MINT}
  `;
  assert.equal(created[0]?.signer_suspended, true);
  assert.equal(created[0]?.reserve, "5000000");
  assert.equal(created[0]?.cap, "100000000");
  assert.equal(Number(created[0]?.slippage_bps), 100);
  await db()`
    update reward_controls
    set signer_suspended = false, reserve_lamports = 1
    where parent_mint_address = ${MINT}
  `;
  assert.equal(await ensureTestParentControls(db(), MINT), "preserved");
  const preserved = await db()`
    select signer_suspended, reserve_lamports::text as reserve
    from reward_controls where parent_mint_address = ${MINT}
  `;
  assert.equal(preserved[0]?.signer_suspended, false);
  assert.equal(preserved[0]?.reserve, "1");
  assert.equal(await ensureTestParentControls(db(), PRODUCTION_MINT), "rejected");
  const productionControl = await db()`
    select reserve_lamports::text as reserve from reward_controls where parent_mint_address = ${PRODUCTION_MINT}
  `;
  assert.equal(productionControl[0]?.reserve, "0");
});

test("the confirmed collection recovery commits on the migrated schema and protects deferred funds", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sdk-rewards-recovery-"));
  const recoveryDb = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55436,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  const mint = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
  const signature = "3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF";
  let recoverySql: ReturnType<typeof createSql> | null = null;
  try {
    await recoveryDb.initialise();
    await recoveryDb.start();
    await recoveryDb.createDatabase("rewards");
    recoverySql = createSql("postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55436/rewards");
    await recoverySql.unsafe(`
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
    const files = (await readdir(migrationDir))
      .filter((file) => file.endsWith(".sql") && file !== "20261022013000_trest07l_continuous_windows.sql" && file !== "20261026190000_sdk_prod_01a_canonical_parent.sql")
      .sort();
    for (const file of files) await recoverySql.unsafe(await readFile(path.join(migrationDir, file), "utf8"));
    await recoverySql`
      insert into parent_registrations (
        scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
        token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
        verified_at, registered_by, evidence_hash
      ) values (
        'test', 'TREST', ${mint}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 6, false,
        '11111111111111111111111111111111', true, 'verified', now(), ${DEPLOYER}, ${HASH}
      )
    `;
    await recoverySql`
      insert into reward_intents (
        parent_registration_id, parent_mint_address, scope, kind, idempotency_key, status, signature, amount_lamports
      )
      select id, ${mint}, 'test', 'collect', 'collect-1792603200000', 'uncertain', ${signature}, 0
      from parent_registrations where mint_address = ${mint}
    `;
    const store = postgresRewardsStore(recoverySql);
    const recovery = {
      parentMint: mint,
      scope: "test" as const,
      idempotencyKey: "collect-1792603200000",
      signature,
      priorStatus: "uncertain" as const,
      approval: "TREST-07J-COLLECTION-RECOVERY",
      operator: "trest-07k",
      reason: "reconcile the confirmed 21 October creator-fee collection",
      grossLamports: "85145307",
      feeLamports: "5000",
      netLamports: "85140307",
      reserveLamports: "5000000",
      holderLamports: "24042092",
      buybackLamports: "24042092",
      deployerLamports: "32056123",
      snapshotStatus: "historical_unavailable" as const,
      gross: "85145307",
      fee: "5000",
      native: "85145307",
      wsolConverted: "0",
      rentExcluded: "0",
      slot: "459711211",
    };
    assert.equal(await store.commitCollectionRecovery({ ...recovery, amountLamports: "90000000" }), "rejected");
    const rolled = await recoverySql`
      select
        (select count(*)::int from reward_collection_recoveries) as audits,
        (select count(*)::int from reward_collections) as receipts,
        (select status from reward_intents where idempotency_key = 'collect-1792603200000') as status
    `;
    assert.equal(Number(rolled[0]?.audits), 0);
    assert.equal(Number(rolled[0]?.receipts), 0);
    assert.equal(rolled[0]?.status, "uncertain");
    assert.equal(await store.commitCollectionRecovery({ ...recovery, amountLamports: "85140307" }), "ok");
    assert.equal(await store.commitCollectionRecovery({ ...recovery, amountLamports: "85140307" }), "duplicate");
    const saved = await recoverySql`
      select
        receipt.id::text as receipt_id,
        receipt.amount_lamports::text as amount,
        receipt.network_fee_lamports::text as fee,
        receipt.allocation_deferred,
        receipt.slot::text as slot,
        audit.id::text as audit_id,
        intent.status,
        intent.signature,
        (select count(*)::int from reward_collections) as receipts,
        (select count(*)::int from reward_collection_recoveries) as audits,
        (select count(*)::int from reward_snapshots where parent_mint_address = ${mint}) as snapshots,
        (select count(*)::int from reward_liabilities where parent_mint_address = ${mint}) as liabilities
      from reward_collections receipt
      join reward_collection_recoveries audit on audit.signature = receipt.signature
      join reward_intents intent on intent.signature = receipt.signature
    `;
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.amount, "85140307");
    assert.equal(saved[0]?.fee, "5000");
    assert.equal(saved[0]?.allocation_deferred, true);
    assert.equal(saved[0]?.slot, "459711211");
    assert.equal(saved[0]?.status, "confirmed");
    assert.equal(saved[0]?.signature, signature);
    assert.equal(Number(saved[0]?.receipts), 1);
    assert.equal(Number(saved[0]?.audits), 1);
    assert.equal(Number(saved[0]?.snapshots), 0);
    assert.equal(Number(saved[0]?.liabilities), 0);
    assert.ok(saved[0]?.receipt_id);
    assert.ok(saved[0]?.audit_id);
    const protectedFunds = await store.solObligations(mint, "test");
    assert.deepEqual({
      holders: protectedFunds.deferredHolderLamports,
      buyback: protectedFunds.deferredBuybackLamports,
      deployer: protectedFunds.deferredDeployerLamports,
      recordedHolders: protectedFunds.holderSol,
    }, {
      holders: "24042092",
      buyback: "24042092",
      deployer: "32056123",
      recordedHolders: "0",
    });
    const buybackKey = "buyback-1792603200000";
    const buybackSignature = "5".repeat(88);
    assert.equal(await store.holdDeferredBuyback({
      parentMint: mint,
      scope: "test",
      idempotencyKey: buybackKey,
      budgetLamports: "24042092",
      collectionSignature: signature,
    }), "held");
    assert.equal(await store.holdDeferredBuyback({
      parentMint: mint,
      scope: "test",
      idempotencyKey: buybackKey,
      budgetLamports: "24042092",
      collectionSignature: signature,
    }), "resume");
    assert.equal(await store.markIntent(mint, "test", buybackKey, "submitted", buybackSignature), "ok");
    const duringFlight = await store.solObligations(mint, "test");
    assert.equal(duringFlight.deferredBuybackLamports, "24042092");
    assert.equal(duringFlight.deferredHolderLamports, "24042092");
    assert.equal(await store.settleDeferredBuyback({
      parentMint: mint,
      scope: "test",
      idempotencyKey: buybackKey,
      signature: buybackSignature,
      solSpentLamports: "24037092",
      tokenAmount: "99",
      budgetLamports: "24042092",
    }), "ok");
    assert.equal(await store.settleDeferredBuyback({
      parentMint: mint,
      scope: "test",
      idempotencyKey: buybackKey,
      signature: buybackSignature,
      solSpentLamports: "24037092",
      tokenAmount: "99",
      budgetLamports: "24042092",
    }), "order");
    const afterBuy = await store.solObligations(mint, "test");
    assert.equal(afterBuy.deferredBuybackLamports, "5000");
    assert.equal(afterBuy.deferredHolderLamports, "24042092");
    assert.equal(afterBuy.deferredDeployerLamports, "32056123");
    assert.equal(afterBuy.holderSol, "0");
    const buybackRows = await recoverySql`
      select status, amount_lamports::text as spent, token_amount, signature
      from reward_intents
      where idempotency_key = ${buybackKey}
    `;
    assert.equal(buybackRows.length, 1);
    assert.equal(buybackRows[0]?.status, "confirmed");
    assert.equal(buybackRows[0]?.spent, "24037092");
    assert.equal(buybackRows[0]?.token_amount, "99");
    const stillDeferred = await recoverySql`
      select allocation_deferred, allocated_at from reward_collections where signature = ${signature}
    `;
    assert.equal(stillDeferred[0]?.allocation_deferred, true);
    assert.equal(stillDeferred[0]?.allocated_at, null);
    const windowKey = rewardWindowKey(mint, "test", START + 1);
    assert.ok(windowKey);
    assert.equal(await store.saveReceipt({
      signature: "H".repeat(88),
      parentMint: mint,
      scope: "test",
      amountLamports: "1000",
      slot: "45",
      confirmed: true,
      source: "creator_vault",
      gross: "1000",
      fee: "0",
      native: "1000",
      wsolConverted: "0",
      rentExcluded: "0",
    }), "ok");
    const ordinary = await store.allocateUnallocated({ parentMint: mint, scope: "test", windowKey, reserveLamports: "0" });
    assert.equal(ordinary.ok, true);
    if (!ordinary.ok || ordinary.state !== "allocated") return;
    assert.equal(ordinary.holders, "500");
    assert.equal(ordinary.buyback, "0");
    assert.equal(ordinary.deployer, "500");
    const combined = await store.solObligations(mint, "test");
    assert.equal(combined.holderSol, "500");
    assert.equal(combined.deferredHolderLamports, "24042092");
    const deferredOnly = await store.allocateUnallocated({
      parentMint: mint,
      scope: "test",
      windowKey: rewardWindowKey(mint, "test", START + 300_001) ?? "",
      reserveLamports: "5000000",
    });
    assert.deepEqual(deferredOnly, { ok: true, state: "empty" });
    const firstGeneration = [START, START + 300_000, START + 600_000];
    assert.equal(await store.registerRehearsal({
      parentMint: mint,
      scope: "test",
      windowStartsMs: firstGeneration,
      generation: 1,
      requireUpcoming: false,
    }), "ok");
    for (const windowStartMs of firstGeneration) {
      assert.equal((await store.claimRehearsalWindow({ parentMint: mint, scope: "test", windowStartMs })).ok, true);
      assert.equal(await store.finishRehearsalWindow({ parentMint: mint, scope: "test", windowStartMs, outcome: "ok" }), "ok");
    }
    assert.equal((await store.rehearsalState(mint, "test"))?.status, "closed");
    const six = Array.from({ length: 6 }, (_, index) => START + 900_000 + index * 300_000);
    assert.equal(await store.registerRehearsal({
      parentMint: mint,
      scope: "test",
      windowStartsMs: six,
      generation: 2,
      requireUpcoming: false,
    }), "ok");
    const continued = await store.rehearsalState(mint, "test");
    assert.equal(continued?.generation, 2);
    assert.equal(continued?.status, "open");
    assert.equal(continued?.windowStartsMs.length, 6);
    const historical = await recoverySql`
      select allocation_deferred, allocated_at
      from reward_collections
      where signature = ${signature}
    `;
    assert.equal(historical[0]?.allocation_deferred, true);
    assert.equal(historical[0]?.allocated_at, null);
    for (const windowStartMs of six.slice(0, 3)) {
      assert.equal((await store.claimRehearsalWindow({ parentMint: mint, scope: "test", windowStartMs })).ok, true);
      assert.equal(await store.finishRehearsalWindow({ parentMint: mint, scope: "test", windowStartMs, outcome: "ok" }), "ok");
    }
    assert.equal((await store.rehearsalState(mint, "test"))?.status, "open");
    for (const windowStartMs of six.slice(3)) {
      assert.equal((await store.claimRehearsalWindow({ parentMint: mint, scope: "test", windowStartMs })).ok, true);
      assert.equal(await store.finishRehearsalWindow({ parentMint: mint, scope: "test", windowStartMs, outcome: "ok" }), "ok");
    }
    assert.equal((await store.rehearsalState(mint, "test"))?.status, "closed");
    assert.equal(await store.saveReceipt({
      signature: "J".repeat(88),
      parentMint: mint,
      scope: "test",
      amountLamports: "1000",
      slot: "46",
      confirmed: true,
      source: "creator_vault",
      gross: "1000",
      fee: "0",
      native: "1000",
      wsolConverted: "0",
      rentExcluded: "0",
    }), "ok");
    assert.equal(await store.registerRehearsal({
      parentMint: mint,
      scope: "test",
      windowStartsMs: Array.from({ length: 3 }, (_, index) => START + 2_700_000 + index * 300_000),
      generation: 3,
      requireUpcoming: false,
    }), "rejected");
    assert.equal(await store.registerRehearsal({
      parentMint: mint,
      scope: "test",
      windowStartsMs: Array.from({ length: 3 }, (_, index) => START + 2_700_000 + index * 300_000),
      generation: 4,
      requireUpcoming: false,
    }), "rejected");
    await recoverySql`
      update reward_collections
      set allocated_at = now(), reserve_withheld_lamports = amount_lamports
      where signature = ${signature}
    `;
    const handedOff = await store.solObligations(mint, "test");
    assert.equal(handedOff.deferredHolderLamports, "0");
    assert.equal(handedOff.deferredBuybackLamports, "0");
    assert.equal(handedOff.deferredDeployerLamports, "0");
    assert.equal(handedOff.holderSol, "500");
  } finally {
    await recoverySql?.end({ timeout: 5 });
    await recoveryDb.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
