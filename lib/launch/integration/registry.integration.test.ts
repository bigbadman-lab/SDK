import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

import { writeSubmission, selectOpenSubmission, selectVerifiedLaunches } from "../registry.ts";
import type { SubmissionIntent } from "../submission.ts";
import { verificationStamp } from "../verified-launch.ts";

const LAUNCHER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const ORIGINATOR = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const CHILD = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const OTHER_CHILD = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const PRODUCTION = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const HASH = "ab".repeat(32);
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const ORIGIN_ACCOUNT = "99999999-9999-4999-8999-999999999999";
const ASSET = "22222222-2222-4222-8222-222222222222";
const LIBRARY = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const LAUNCH = "55555555-5555-4555-8555-555555555555";
const BUILD = "66666666-6666-4666-8666-666666666666";
const FAILED_LAUNCH = "77777777-7777-4777-8777-777777777777";
const FAILED_BUILD = "88888888-8888-4888-8888-888888888888";
const OPEN_LAUNCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPEN_BUILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROD_LAUNCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROD_BUILD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type EmbeddedDatabase = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
};

let database: EmbeddedDatabase | null = null;
let directory = "";
let sql: postgres.Sql | null = null;

function intent(patch: Partial<SubmissionIntent> = {}): SubmissionIntent {
  return {
    launchId: LAUNCH,
    buildId: BUILD,
    childMint: CHILD,
    parentMint: TREST,
    scope: "test",
    wallet: LAUNCHER,
    signature: "2".repeat(88),
    messageHash: HASH,
    status: "submission_pending",
    wireRetained: true,
    ...patch,
  };
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sdk-launch-"));
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dirname, "../../../services/rewards-worker/node_modules/embedded-postgres/dist/index.js"),
  ).href;
  const imported = (await import(moduleUrl)) as {
    default: new (options: Record<string, unknown>) => EmbeddedDatabase;
  };
  database = new imported.default({
    databaseDir: directory,
    user: "sdk_launch",
    password: "sdk_launch_local",
    port: 55441,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await database.initialise();
  await database.start();
  await database.createDatabase("launches");
  const url = new URL("postgres://sdk_launch:sdk_launch_local@127.0.0.1:55441/launches");
  assert.equal(url.hostname, "127.0.0.1");
  assert.notEqual(url.toString(), process.env.DATABASE_URL);
  sql = postgres(url.toString(), { max: 1, ssl: false });
  await sql.unsafe(`
    create extension if not exists pgcrypto;
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
    .filter((file) => file.endsWith(".sql") && file !== "20261022013000_trest07l_continuous_windows.sql")
    .sort();
  for (const file of files) {
    await sql.unsafe(await readFile(path.join(migrationDir, file), "utf8"));
  }
  await sql`
    insert into accounts (id, wallet_address) values
      (${ACCOUNT}, ${LAUNCHER}),
      (${ORIGIN_ACCOUNT}, ${ORIGINATOR})
  `;
  await sql`
    insert into token_assets (
      id, account_id, content_hash, content_type, width, height, byte_size, storage_path, image_ipfs_uri
    ) values (
      ${ASSET}, ${ACCOUNT}, ${HASH}, 'image/png', 64, 64, 128,
      ${`${ACCOUNT}/${ASSET}.png`}, 'https://example.test/lesson.png'
    )
  `;
  await sql`
    insert into library_sdks (
      id, origin, status, originator_account_id, originator_label, name, description
    ) values (
      ${LIBRARY}, 'community', 'published', ${ORIGIN_ACCOUNT}, 'Originator', 'Lesson SDK', 'A tested community SDK.'
    )
  `;
  await sql`
    insert into library_versions (id, sdk_id, version_number, content_hash, blueprint)
    values (${VERSION}, ${LIBRARY}, 1, ${HASH}, '{"steps":[]}'::jsonb)
  `;
  await sql`update library_sdks set current_version_id = ${VERSION} where id = ${LIBRARY}`;
  await sql`
    insert into parent_registrations (
      scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode, token_program,
      decimals, graduated, quote_mint_address, eligible, eligibility_reason, verified_at, registered_by, evidence_hash
    ) values (
      'test', 'TREST', ${TREST}, ${ORIGINATOR}, ${ORIGINATOR}, 'single_recipient', ${TOKEN},
      6, false, '11111111111111111111111111111111', true, 'verified', now(), ${ORIGINATOR}, ${HASH}
    )
  `;
  await insertLaunch(sql, {
    launchId: LAUNCH,
    buildId: BUILD,
    idempotency: "12121212-1212-4121-8121-121212121212",
    child: CHILD,
    scope: "test",
    parent: TREST,
  });
  await insertLaunch(sql, {
    launchId: FAILED_LAUNCH,
    buildId: FAILED_BUILD,
    idempotency: "13131313-1313-4131-8131-131313131313",
    child: OTHER_CHILD,
    scope: "test",
    parent: TREST,
  });
  await insertLaunch(sql, {
    launchId: OPEN_LAUNCH,
    buildId: OPEN_BUILD,
    idempotency: "14141414-1414-4141-8141-141414141414",
    child: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
    scope: "test",
    parent: TREST,
  });
  await insertLaunch(sql, {
    launchId: PROD_LAUNCH,
    buildId: PROD_BUILD,
    idempotency: "15151515-1515-4151-8151-151515151515",
    child: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
    scope: "production",
    parent: null,
  });
});

after(async () => {
  await sql?.end({ timeout: 5 });
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("a verified TREST child is stored once and the same record feeds every page", async () => {
  const db = sql;
  assert.ok(db);
  const now = Date.parse("2026-10-22T09:00:00.000Z");
  const pending = intent();
  const opened = await writeSubmission(db, {
    intent: pending,
    accountId: ACCOUNT,
    ciphertext: "cipher-one",
    stamp: verificationStamp({
      status: pending.status,
      evidenceSlot: null,
      nowMs: now,
      storedSlot: null,
      storedVerifiedAtMs: null,
    }),
  });
  assert.equal(opened, "ok");
  assert.equal((await selectVerifiedLaunches(db)).length, 0);
  const verifiedIntent = intent({ status: "verified" });
  const stamp = verificationStamp({
    status: "verified",
    evidenceSlot: "44",
    nowMs: now,
    storedSlot: null,
    storedVerifiedAtMs: null,
  });
  assert.equal(await writeSubmission(db, { intent: verifiedIntent, accountId: ACCOUNT, ciphertext: "cipher-one", stamp }), "ok");
  assert.equal(
    await writeSubmission(db, {
      intent: verifiedIntent,
      accountId: ACCOUNT,
      ciphertext: "cipher-one",
      stamp: { status: "verified", slot: "90", verifiedAtMs: now + 1000, attemptStatus: "verified" },
    }),
    "ok",
  );
  const conflict = await writeSubmission(db, {
    intent: intent({ signature: "3".repeat(88) }),
    accountId: ACCOUNT,
    ciphertext: "cipher-one",
    stamp,
  });
  assert.equal(conflict, "conflict");
  await writeSubmission(db, {
    intent: intent({
      launchId: FAILED_LAUNCH,
      buildId: FAILED_BUILD,
      childMint: OTHER_CHILD,
      signature: "4".repeat(88),
      status: "failed",
    }),
    accountId: ACCOUNT,
    ciphertext: "cipher-failed",
    stamp: verificationStamp({ status: "failed", evidenceSlot: "44", nowMs: now, storedSlot: null, storedVerifiedAtMs: null }),
  });
  await writeSubmission(db, {
    intent: intent({
      launchId: OPEN_LAUNCH,
      buildId: OPEN_BUILD,
      childMint: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      signature: "5".repeat(88),
      status: "submitted",
    }),
    accountId: ACCOUNT,
    ciphertext: "cipher-open",
    stamp: verificationStamp({ status: "submitted", evidenceSlot: null, nowMs: now, storedSlot: null, storedVerifiedAtMs: null }),
  });
  await writeSubmission(db, {
    intent: intent({
      launchId: PROD_LAUNCH,
      buildId: PROD_BUILD,
      childMint: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
      parentMint: PRODUCTION,
      scope: "production",
      signature: "6".repeat(88),
      status: "verified",
    }),
    accountId: ACCOUNT,
    ciphertext: "cipher-prod",
    stamp: verificationStamp({ status: "verified", evidenceSlot: "45", nowMs: now, storedSlot: null, storedVerifiedAtMs: null }),
  });
  const rows = await db<{ status: string; slot: string; verified_at: Date; signatures: number }[]>`
    select status, slot::text as slot, verified_at, count(*)::int as signatures
    from launch_submissions
    where launch_id = ${LAUNCH}
    group by status, slot, verified_at
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "verified");
  assert.equal(rows[0]?.slot, "44");
  assert.equal(new Date(rows[0]?.verified_at ?? 0).toISOString(), "2026-10-22T09:00:00.000Z");
  const attempt = await db<{ attempt_status: string; attempt_mint_address: string }[]>`
    select attempt_status, attempt_mint_address from token_launches where id = ${LAUNCH}
  `;
  assert.equal(attempt[0]?.attempt_status, "verified");
  assert.equal(attempt[0]?.attempt_mint_address, CHILD);
  const unresolved = await db<{ launch_id: string; status: string }[]>`
    select launch_id, status from launch_submissions
    where account_id = ${ACCOUNT}
      and status in ('submission_pending', 'submitted', 'pending_confirmation', 'verifying', 'uncertain')
  `;
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0]?.launch_id, OPEN_LAUNCH);
  assert.equal(unresolved[0]?.status, "submitted");
  assert.equal((await selectOpenSubmission(db, ACCOUNT))?.launchId, OPEN_LAUNCH);
  const bare = await db`
    update launch_submissions
    set status = 'verified', slot = null, verified_at = null
    where launch_id = ${FAILED_LAUNCH}
  `.then(() => "stored", () => "rejected");
  assert.equal(bare, "rejected");
  const paired = await selectVerifiedLaunches(db);
  const feed = await selectVerifiedLaunches(db);
  const account = await selectVerifiedLaunches(db, { creator: LAUNCHER });
  const detail = await selectVerifiedLaunches(db, { mint: CHILD });
  const stranger = await selectVerifiedLaunches(db, { creator: ORIGINATOR });
  assert.equal(paired.length, 1);
  assert.equal(paired[0]?.pairLabel, "$TREST");
  assert.equal(paired[0]?.parentMint, TREST);
  assert.equal(paired[0]?.name, "Lesson");
  assert.equal(paired[0]?.sdkName, "Lesson SDK");
  assert.equal(paired[0]?.sdkHref, `/library/${LIBRARY}`);
  assert.equal(feed[0]?.childMint, paired[0]?.childMint);
  assert.equal(account[0]?.childMint, paired[0]?.childMint);
  assert.equal(detail[0]?.childMint, CHILD);
  assert.equal(stranger.length, 0);
  assert.equal(paired.some((row) => row.scope === "production"), false);
  assert.equal(paired.some((row) => row.pairLabel === "$SDK"), false);
});

async function insertLaunch(
  db: postgres.Sql,
  input: {
    launchId: string;
    buildId: string;
    idempotency: string;
    child: string;
    scope: "production" | "test";
    parent: string | null;
  },
): Promise<void> {
  await db`
    insert into token_launches (
      id, account_id, wallet_address, idempotency_key, source_kind, library_sdk_id, library_version_id,
      content_hash, origin, originator_account_id, originator_label, fee_category, token_name, token_symbol,
      token_description, asset_id, payload_hash, metadata_hash, metadata_ipfs_uri, image_ipfs_uri, buy_amount,
      status, parent_scope, parent_mint_address
    ) values (
      ${input.launchId}, ${ACCOUNT}, ${LAUNCHER}, ${input.idempotency}, 'library', ${LIBRARY}, ${VERSION},
      ${HASH}, 'community', ${ORIGIN_ACCOUNT}, 'Originator', 'community_split', 'Lesson', 'LESSON',
      'A verified lesson token.', ${ASSET}, ${HASH}, ${HASH}, 'https://example.test/metadata.json',
      'https://example.test/lesson.png', '0', 'ready_for_transaction', ${input.scope}, ${input.parent}
    )
  `;
  await db`
    insert into launch_builds (
      id, launch_id, account_id, wallet_address, idempotency_key, payload_hash, mint_address,
      parent_mint_address, content_hash, metadata_hash, metadata_uri, fee_category, shareholders,
      buy_amount, blockhash, message_hash, transaction, coverage, status, expires_at
    ) values (
      ${input.buildId}, ${input.launchId}, ${ACCOUNT}, ${LAUNCHER}, ${input.idempotency}, ${HASH}, ${input.child},
      ${input.parent ?? TREST}, ${HASH}, ${HASH}, 'https://example.test/metadata.json', 'community_split',
      ${db.json([{ address: LAUNCHER, shareBps: 6000 }, { address: ORIGINATOR, shareBps: 2500 }, { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 1500 }])},
      '0', ${LAUNCHER}, ${HASH}, 'aaaaaaaaaaaaaaaa', 'live', 'built', now() + interval '1 hour'
    )
  `;
}
