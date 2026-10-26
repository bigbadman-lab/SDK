import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import EmbeddedPostgres from "embedded-postgres";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import { WINDOW_MS } from "../../../lib/rewards/ledger.ts";
import { createSql } from "./postgres.ts";
import {
  databaseNow,
  DEFAULT_LEAD_MINUTES,
  DAY_REHEARSAL_APPROVAL,
  REHEARSAL_APPROVAL,
  rehearsalFencePresent,
  selectRehearsalWindows,
  cliMain,
  type RehearsalIo,
  type SuspensionEvidence,
} from "./rehearsal-register-cli.ts";
import { memoryStore, TREST_REHEARSAL_MINT, validRehearsalStarts, type RegisteredParent, type RewardsStore } from "./store.ts";

const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const SYSTEM = "11111111111111111111111111111111";
const NOW = Date.UTC(2026, 9, 21, 15, 7, 30);
const SECRET = "do-not-print-this-private-key";
const DATABASE = "postgres://operator:do-not-print-database-password@127.0.0.1:1/rewards";
const RENDER_KEY = "do-not-print-render-token";

function quiet(): SuspensionEvidence {
  return {
    loopEnabled: "false",
    executionAuthorised: "false",
    signerSuspended: "true",
    runtime: "suspended",
    loop: false,
    broadcasts: false,
    executionAuthorisedHealth: false,
  };
}

function parent(mint = TREST_REHEARSAL_MINT): RegisteredParent {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    scope: "test",
    symbol: "TREST",
    mintAddress: mint,
    deployerAddress: DEPLOYER,
    feeRecipientAddress: DEPLOYER,
    feeMode: "single_recipient",
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 6,
    graduated: false,
    quoteMintAddress: SYSTEM,
    eligible: true,
  };
}

function fixture(suspended = true, mint = TREST_REHEARSAL_MINT) {
  return memoryStore({
    parent: parent(mint),
    control: { suspended, reserveLamports: "5000000", cycleCapLamports: "100000000", slippageBps: 100 },
  });
}

function command(extra: string[] = []): string[] {
  return ["node", "rehearsal-register-cli.ts", "--approval", REHEARSAL_APPROVAL, "--operator", "operator-1", "--reason", "Register the single three-window rehearsal.", ...extra];
}

function environment(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    TREST_REHEARSAL_REGISTRATION_AUTHORIZED: "true",
    REWARDS_LOOP_ENABLED: "true",
    REWARDS_EXECUTION_AUTHORIZED: "true",
    TREST_SIGNER_SUSPENDED: "false",
    DATABASE_URL: DATABASE,
    RENDER_API_KEY: RENDER_KEY,
    TREST_DEPLOYER_PRIVATE_KEY: SECRET,
    SDK_DEPLOYER_PRIVATE_KEY: SECRET,
    HELIUS_RPC_URL: "https://do-not-print-helius.example",
    ...patch,
  };
}

function io(store: RewardsStore, patch: RehearsalIo = {}, readLiveSuspension = false): RehearsalIo {
  const base: RehearsalIo = {
    store,
    now: async () => NOW,
    fence: async () => true,
    ...patch,
  };
  if (!readLiveSuspension && !patch.suspension) base.suspension = async () => quiet();
  return base;
}

function safe(text: string) {
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("do-not-print-database-password"), false);
  assert.equal(text.includes(RENDER_KEY), false);
  assert.equal(text.includes("do-not-print-helius"), false);
}

async function control(store: RewardsStore) {
  return store.control(TREST_REHEARSAL_MINT, "test");
}

test("window selection uses the database instant and a bounded lead", () => {
  const selected = selectRehearsalWindows(NOW, DEFAULT_LEAD_MINUTES);
  assert.ok(selected);
  assert.equal(selected[0], Date.UTC(2026, 9, 21, 15, 20, 0));
  assert.equal(selected[1], selected[0] + WINDOW_MS);
  assert.equal(selected[2], selected[0] + WINDOW_MS * 2);
  assert.equal(selected[0] - NOW >= DEFAULT_LEAD_MINUTES * 60_000, true);
  assert.equal(selectRehearsalWindows(Date.UTC(2026, 9, 21, 15, 0, 0), 10)?.[0], Date.UTC(2026, 9, 21, 15, 10, 0));
  assert.equal(selectRehearsalWindows(NOW, 9), null);
  assert.equal(selectRehearsalWindows(NOW, 181), null);
  assert.equal(selectRehearsalWindows(NOW, 15)?.[0], Date.UTC(2026, 9, 21, 15, 25, 0));
  const six = selectRehearsalWindows(NOW, DEFAULT_LEAD_MINUTES, 6);
  assert.equal(six?.length, 6);
  assert.equal(six?.[5], (six?.[0] ?? 0) + WINDOW_MS * 5);
  assert.equal(selectRehearsalWindows(NOW, DEFAULT_LEAD_MINUTES, 3)?.length, 3);
});

test("dry-run previews three keys and does not write", async () => {
  const store = fixture();
  let writes = 0;
  const register = store.registerRehearsal.bind(store);
  store.registerRehearsal = async (input) => {
    writes += 1;
    return register(input);
  };
  const result = await cliMain(command(["--dry-run"]), environment({ TREST_REHEARSAL_REGISTRATION_AUTHORIZED: undefined }), io(store));
  assert.equal(result.code, 0);
  assert.match(result.out, /^dry-run/);
  assert.match(result.out, /database_utc=2026-10-21T15:07:30.000Z/);
  assert.match(result.out, /first=2026-10-21T15:20:00.000Z/);
  assert.match(result.out, /second=2026-10-21T15:25:00.000Z/);
  assert.match(result.out, /third=2026-10-21T15:30:00.000Z/);
  assert.match(result.out, /lead_ms=750000/);
  assert.match(result.out, /existing=0/);
  assert.match(result.out, /accepted=yes/);
  assert.equal(writes, 0);
  assert.equal(await store.rehearsalState(TREST_REHEARSAL_MINT, "test"), null);
  assert.equal((await control(store))?.suspended, true);
  safe(result.out);
});

test("registration arguments and authorisation fail closed", async () => {
  const store = fixture();
  const cases: Array<[string[], Record<string, string | undefined>, string]> = [
    [command().filter((token) => token !== "--approval" && token !== REHEARSAL_APPROVAL), environment(), "rejected argument"],
    [command().map((token) => (token === REHEARSAL_APPROVAL ? "TREST-07I-WRONG" : token)), environment(), "rejected approval"],
    [command(), environment({ TREST_REHEARSAL_REGISTRATION_AUTHORIZED: undefined }), "rejected authorisation"],
    [command(), environment({ TREST_REHEARSAL_REGISTRATION_AUTHORIZED: "false" }), "rejected authorisation"],
    [command().map((token) => (token === "operator-1" ? "bad operator" : token)), environment(), "rejected operator"],
    [command().map((token) => (token === "operator-1" ? "x".repeat(81) : token)), environment(), "rejected operator"],
    [command().map((token) => (token.startsWith("Register ") ? " " : token)), environment(), "rejected reason"],
    [command(["--mint", TREST_REHEARSAL_MINT]), environment(), "rejected argument"],
    [command(["--scope", "production"]), environment(), "rejected argument"],
    [command(["--signer", DEPLOYER]), environment(), "rejected argument"],
    [command(["--destination", DEPLOYER]), environment(), "rejected argument"],
    [command(["--database-url", DATABASE]), environment(), "rejected argument"],
    [command(["--lead-minutes", "9"]), environment(), "rejected lead"],
    [command(["--lead-minutes", "0"]), environment(), "rejected lead"],
    [command(["--lead-minutes", "181"]), environment(), "rejected lead"],
    [command(["--lead-minutes", "10.5"]), environment(), "rejected lead"],
  ];
  for (const [argv, env, expected] of cases) {
    const result = await cliMain(argv, env, io(store));
    assert.equal(result.out, expected);
    assert.equal(result.code, 2);
    safe(result.out);
  }
  assert.equal(await store.rehearsalState(TREST_REHEARSAL_MINT, "test"), null);
});

test("live suspension and the database fence are required", async () => {
  const store = fixture();
  let writes = 0;
  store.registerRehearsal = async () => {
    writes += 1;
    return "ok";
  };
  const missingRender = await cliMain(command(), environment({ RENDER_API_KEY: undefined }), io(store, {}, true));
  assert.equal(missingRender.out, "rejected render");
  const active = await cliMain(command(), environment(), io(store, { suspension: async () => ({ ...quiet(), loopEnabled: "true" }) }));
  assert.equal(active.out, "rejected suspended");
  const broadcasting = await cliMain(command(), environment(), io(store, { suspension: async () => ({ ...quiet(), broadcasts: true }) }));
  assert.equal(broadcasting.out, "rejected suspended");
  const noFence = await cliMain(command(), environment(), io(store, { fence: async () => false }));
  assert.equal(noFence.out, "rejected fence");
  const unsuspended = await cliMain(command(), environment(), io(fixture(false)));
  assert.equal(unsuspended.out, "rejected suspended");
  const missing = await cliMain(command(), environment(), io(fixture(true, "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse")));
  assert.equal(missing.out, "rejected suspended");
  assert.equal(writes, 0);
  assert.equal((await control(store))?.suspended, true);
  assert.equal((await control(store))?.reserveLamports, "5000000");
});

test("an existing open or closed schedule is never replaced", async () => {
  const open = fixture();
  const start = Date.UTC(2026, 9, 21, 16, 0, 0);
  assert.equal(await open.registerRehearsal({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    windowStartsMs: [start, start + WINDOW_MS, start + WINDOW_MS * 2],
    requireUpcoming: false,
  }), "ok");
  let writes = 0;
  const registerOpen = open.registerRehearsal.bind(open);
  open.registerRehearsal = async (input) => {
    writes += 1;
    return registerOpen(input);
  };
  const opened = await cliMain(command(), environment(), io(open));
  assert.equal(opened.out, "rejected existing");
  const preview = await cliMain(command(["--dry-run"]), environment({ TREST_REHEARSAL_REGISTRATION_AUTHORIZED: undefined }), io(open));
  assert.equal(preview.code, 0);
  assert.match(preview.out, /existing=1/);
  assert.match(preview.out, /accepted=no/);
  assert.equal(writes, 0);

  const closed = fixture();
  assert.equal(await closed.registerRehearsal({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    windowStartsMs: [start, start + WINDOW_MS, start + WINDOW_MS * 2],
    requireUpcoming: false,
  }), "ok");
  for (const windowStartMs of [start, start + WINDOW_MS, start + WINDOW_MS * 2]) {
    assert.equal((await closed.claimRehearsalWindow({ parentMint: TREST_REHEARSAL_MINT, scope: "test", windowStartMs })).ok, true);
    assert.equal(await closed.finishRehearsalWindow({ parentMint: TREST_REHEARSAL_MINT, scope: "test", windowStartMs, outcome: "ok" }), "ok");
  }
  assert.equal((await closed.rehearsalState(TREST_REHEARSAL_MINT, "test"))?.status, "closed");
  const again = await cliMain(command(), environment(), io(closed));
  assert.equal(again.code, 0);
  assert.match(again.out, /^ok/);
  const followed = await closed.rehearsalState(TREST_REHEARSAL_MINT, "test");
  assert.equal(followed?.status, "open");
  assert.equal(followed?.generation, 2);
  assert.equal(followed?.windowStartsMs[0], Date.UTC(2026, 9, 21, 15, 20, 0));
  const replaced = await closed.claimRehearsalWindow({ parentMint: TREST_REHEARSAL_MINT, scope: "test", windowStartMs: start });
  assert.equal(replaced.ok, false);
  if (!replaced.ok) assert.equal(replaced.code, "schedule");
});

test("one registration is immutable and a lost response is reconciled without a repeat", async () => {
  const store = fixture();
  const before = await control(store);
  const created = await cliMain(command(["--lead-minutes", "15"]), environment(), io(store));
  assert.equal(created.code, 0);
  assert.match(created.out, /^ok/);
  assert.match(created.out, /first=2026-10-21T15:25:00.000Z/);
  assert.match(created.out, /claimed=0/);
  assert.match(created.out, /status=open/);
  const saved = await store.rehearsalState(TREST_REHEARSAL_MINT, "test");
  assert.equal(saved?.status, "open");
  assert.equal(saved?.processed.length, 0);
  assert.equal(saved?.blocksSideWork, true);
  assert.equal(saved?.windowStartsMs.length, 3);
  const duplicate = await cliMain(command(), environment(), io(store));
  assert.equal(duplicate.out, "rejected existing");
  const outside = await store.claimRehearsalWindow({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    windowStartMs: (saved?.windowStartsMs[2] ?? 0) + WINDOW_MS,
  });
  assert.equal(outside.ok, false);
  assert.deepEqual(await control(store), before);

  const lost = fixture();
  const original = lost.registerRehearsal.bind(lost);
  let writes = 0;
  lost.registerRehearsal = async (input) => {
    writes += 1;
    await original(input);
    throw new Error("lost response");
  };
  const reconciled = await cliMain(command(), environment(), io(lost));
  assert.equal(reconciled.code, 0);
  assert.match(reconciled.out, /^reconciled/);
  assert.equal(writes, 1);
  assert.equal((await lost.rehearsalState(TREST_REHEARSAL_MINT, "test"))?.windowStartsMs.length, 3);

  const uncertain = fixture();
  const plant = uncertain.registerRehearsal.bind(uncertain);
  uncertain.registerRehearsal = async () => {
    await plant({
      parentMint: TREST_REHEARSAL_MINT,
      scope: "test",
      windowStartsMs: [Date.UTC(2026, 9, 21, 18, 0, 0), Date.UTC(2026, 9, 21, 18, 5, 0), Date.UTC(2026, 9, 21, 18, 10, 0)],
      requireUpcoming: false,
    });
    throw new Error("lost response");
  };
  const mismatched = await cliMain(command(), environment(), io(uncertain));
  assert.equal(mismatched.out, "rejected uncertain");
  assert.equal((await uncertain.rehearsalState(TREST_REHEARSAL_MINT, "test"))?.windowStartsMs[0], Date.UTC(2026, 9, 21, 18, 0, 0));
  assert.equal((await control(uncertain))?.suspended, true);
  assert.equal((await control(uncertain))?.cycleCapLamports, "100000000");
  const failed = fixture();
  const unchanged = await control(failed);
  failed.registerRehearsal = async () => "rejected";
  const failure = await cliMain(command(), environment(), io(failed));
  assert.equal(failure.out, "rejected registration");
  assert.deepEqual(await control(failed), unchanged);
  assert.equal(await failed.rehearsalState(TREST_REHEARSAL_MINT, "test"), null);
  safe(created.out);
  safe(reconciled.out);
});

test("Render suspension is read from the worker service, not the caller environment", async () => {
  const store = fixture();
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/env-vars?limit=100")) {
      const header = new Headers(init?.headers).get("authorization") ?? "";
      assert.equal(header, `Bearer ${RENDER_KEY}`);
      assert.equal(url.includes("srv-dbbrdfgu01pc738pd27g"), true);
      return new Response(JSON.stringify([
        { envVar: { key: "REWARDS_LOOP_ENABLED", value: "false" } },
        { envVar: { key: "REWARDS_EXECUTION_AUTHORIZED", value: "false" } },
        { envVar: { key: "TREST_SIGNER_SUSPENDED", value: "true" } },
      ]), { status: 200 });
    }
    return new Response(JSON.stringify({
      runtime: "suspended",
      loop: false,
      broadcasts: false,
      executionAuthorised: false,
      signing: false,
    }), { status: 200 });
  };
  try {
    const preview = await cliMain(command(["--dry-run"]), environment({ TREST_REHEARSAL_REGISTRATION_AUTHORIZED: undefined }), io(store, {}, true));
    assert.equal(preview.code, 0);
    assert.match(preview.out, /accepted=yes/);
    safe(preview.out);
    assert.equal(calls.some((url) => url.includes("srv-dbbrdfgu01pc738pd27g")), true);
    assert.equal(calls.some((url) => url === "https://sdk-rewards-worker.onrender.com/health"), true);
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/env-vars?limit=100")) {
        return new Response(JSON.stringify([
          { envVar: { key: "REWARDS_LOOP_ENABLED", value: "true" } },
          { envVar: { key: "REWARDS_EXECUTION_AUTHORIZED", value: "false" } },
          { envVar: { key: "TREST_SIGNER_SUSPENDED", value: "true" } },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({ runtime: "suspended", loop: false, broadcasts: false, executionAuthorised: false }), { status: 200 });
    };
    const active = await cliMain(command(), environment({ REWARDS_LOOP_ENABLED: "false" }), io(store, {}, true));
    assert.equal(active.out, "rejected suspended");
    assert.equal(await store.rehearsalState(TREST_REHEARSAL_MINT, "test"), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("the registration command stays outside the worker and cannot sign", async () => {
  const cli = await readFile(new URL("./rehearsal-register-cli.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const loop = await readFile(new URL("./loop.ts", import.meta.url), "utf8");
  const claims = await readFile(new URL("./claim-route.ts", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.equal(server.includes("rehearsal-register-cli"), false);
  assert.equal(loop.includes("rehearsal-register-cli"), false);
  assert.equal(claims.includes("rehearsal-register-cli"), false);
  assert.match(manifest, /"start": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types src\/server.ts"/);
  assert.match(manifest, /"register-rehearsal":/);
  assert.equal(cli.includes("signInspected"), false);
  assert.equal(cli.includes(".submit("), false);
  assert.equal(cli.includes("TREST_DEPLOYER_PRIVATE_KEY"), false);
  assert.equal(cli.includes("SDK_DEPLOYER_PRIVATE_KEY"), false);
  assert.equal(cli.includes("HELIUS_"), false);
  assert.equal(cli.includes("Date.now"), false);
});

test("disposable PostgreSQL supplies the clock and accepts one schedule", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sdk-rehearsal-cli-"));
  const database = new EmbeddedPostgres({
    databaseDir: directory,
    user: "sdk_rewards",
    password: "sdk_rewards_local",
    port: 55434,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await database.initialise();
  await database.start();
  await database.createDatabase("rewards");
  const databaseUrl = "postgres://sdk_rewards:sdk_rewards_local@127.0.0.1:55434/rewards";
  const sql = createSql(databaseUrl);
  try {
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
    for (const file of files) await sql.unsafe(await readFile(path.join(migrationDir, file), "utf8"));
    const observed = await databaseNow(sql);
    const direct = await sql.unsafe<{ ms: string }[]>("select (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text as ms");
    assert.ok(observed);
    assert.ok(Math.abs(observed - Number(direct[0]?.ms)) < 3000);
    assert.equal(await rehearsalFencePresent(sql), true);
    const hash = "ab".repeat(32);
    await sql`
      insert into parent_registrations (
        scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
        token_program, decimals, graduated, quote_mint_address, eligible, eligibility_reason,
        verified_at, registered_by, evidence_hash
      ) values (
        'test', 'TREST', ${TREST_REHEARSAL_MINT}, ${DEPLOYER}, ${DEPLOYER}, 'single_recipient',
        ${TOKEN_2022_PROGRAM_ID}, 6, false, ${SYSTEM}, true, 'verified', now(), ${DEPLOYER}, ${hash}
      )
    `;
    await sql`
      insert into reward_controls (
        parent_registration_id, parent_mint_address, scope, signer_suspended, reserve_lamports, cycle_cap_lamports, slippage_bps
      )
      select id, ${TREST_REHEARSAL_MINT}, 'test', true, 5000000, 100000000, 100
      from parent_registrations
      where mint_address = ${TREST_REHEARSAL_MINT}
    `;
    const env = environment({ DATABASE_URL: databaseUrl, TREST_REHEARSAL_REGISTRATION_AUTHORIZED: undefined, RENDER_API_KEY: undefined });
    const preview = await cliMain(command(["--dry-run"]), env, { suspension: async () => quiet() });
    assert.equal(preview.code, 0);
    assert.match(preview.out, /^dry-run/);
    assert.match(preview.out, /accepted=yes/);
    assert.match(preview.out, /existing=0/);
    const previewUtc = Number(new Date(preview.out.match(/database_utc=([^\n]+)/)?.[1] ?? "").valueOf());
    const again = await databaseNow(sql);
    assert.ok(again);
    assert.ok(Math.abs(previewUtc - again) < 5000);
    const first = Number(new Date(preview.out.match(/first=([^\n]+)/)?.[1] ?? "").valueOf());
    const second = Number(new Date(preview.out.match(/second=([^\n]+)/)?.[1] ?? "").valueOf());
    const third = Number(new Date(preview.out.match(/third=([^\n]+)/)?.[1] ?? "").valueOf());
    assert.equal(first % WINDOW_MS, 0);
    assert.equal(second, first + WINDOW_MS);
    assert.equal(third, first + WINDOW_MS * 2);
    assert.equal(first > previewUtc + DEFAULT_LEAD_MINUTES * 60_000 - 1, true);
    assert.equal((await sql<{ count: number }[]>`select count(*)::int as count from reward_rehearsals`)[0]?.count, 0);
    const registered = await cliMain(command(), environment({ DATABASE_URL: databaseUrl, RENDER_API_KEY: undefined }), { suspension: async () => quiet() });
    assert.equal(registered.code, 0);
    assert.match(registered.out, /^ok/);
    assert.match(registered.out, /claimed=0/);
    const expected = selectRehearsalWindows(Number(new Date(registered.out.match(/database_utc=([^\n]+)/)?.[1] ?? "").valueOf()), DEFAULT_LEAD_MINUTES);
    assert.ok(expected);
    const rows = await sql<{ status: string; starts: string[] }[]>`
      select status, window_start_ms::text[] as starts from reward_rehearsals
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "open");
    assert.deepEqual(rows[0]?.starts.map(Number), [...expected]);
    assert.equal((await sql<{ count: number }[]>`select count(*)::int as count from reward_rehearsal_windows`)[0]?.count, 0);
    const repeated = await cliMain(command(), environment({ DATABASE_URL: databaseUrl, RENDER_API_KEY: undefined }), { suspension: async () => quiet() });
    assert.equal(repeated.out, "rejected existing");
    assert.equal((await sql<{ count: number }[]>`select count(*)::int as count from reward_rehearsals`)[0]?.count, 1);
    const controls = await sql<{ signer_suspended: boolean; reserve_lamports: string; cycle_cap_lamports: string; slippage_bps: number }[]>`
      select signer_suspended, reserve_lamports::text, cycle_cap_lamports::text, slippage_bps
      from reward_controls
      where parent_mint_address = ${TREST_REHEARSAL_MINT}
    `;
    assert.equal(controls[0]?.signer_suspended, true);
    assert.equal(controls[0]?.reserve_lamports, "5000000");
    assert.equal(controls[0]?.cycle_cap_lamports, "100000000");
    assert.equal(controls[0]?.slippage_bps, 100);
    safe(preview.out);
    safe(registered.out);
  } finally {
    await sql.end({ timeout: 5 });
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a day rehearsal authorises 288 windows and leaves execution suspended", async () => {
  const selected = selectRehearsalWindows(NOW, DEFAULT_LEAD_MINUTES, 288);
  assert.equal(selected?.length, 288);
  const first = selected?.[0] ?? 0;
  assert.equal(selected?.[287], first + 287 * WINDOW_MS);
  const drifted = [...(selected ?? [])];
  drifted[3] = (drifted[3] ?? 0) + 1;
  assert.equal(validRehearsalStarts(drifted), null);
  assert.equal(validRehearsalStarts((selected ?? []).slice(0, 287)), null);
  assert.equal(validRehearsalStarts([...(selected ?? []), (selected?.[287] ?? 0) + WINDOW_MS]), null);
  const store = fixture();
  const args = ["node", "rehearsal-register-cli.ts", "--approval", DAY_REHEARSAL_APPROVAL, "--operator", "operator-1", "--reason", "Register the day rehearsal."];
  const preview = await cliMain([...args, "--dry-run"], environment({ TREST_REHEARSAL_REGISTRATION_AUTHORIZED: undefined }), io(store));
  assert.equal(preview.code, 0);
  assert.match(preview.out, /windows=288/);
  assert.match(preview.out, /first=/);
  assert.match(preview.out, /final=/);
  const created = await cliMain(args, environment(), io(store));
  assert.equal(created.code, 0);
  safe(created.out);
  const saved = await store.rehearsalState(TREST_REHEARSAL_MINT, "test");
  assert.equal(saved?.windowStartsMs.length, 288);
  assert.equal(saved?.status, "open");
  assert.equal(saved?.claimsAllowed, true);
  assert.equal(saved?.blocksSideWork, true);
  assert.equal((await control(store))?.suspended, true);
  const overlap = await cliMain(args, environment(), io(store));
  assert.equal(overlap.out, "rejected existing");
  assert.equal(await store.registerRehearsal({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "production",
    windowStartsMs: selected ?? [],
    requireUpcoming: false,
  }), "rejected");
});
