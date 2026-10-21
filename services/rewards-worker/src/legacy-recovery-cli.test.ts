import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import type { Chain } from "./chain.ts";
import { cliMain, type RecoveryIo } from "./legacy-recovery-cli.ts";
import { memoryStore, type RegisteredParent } from "./store.ts";

const MINT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const FIRST = "collect-1792587300000";
const SECOND = "collect-1792587600000";
const FIRST_SIGNATURE = "3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m";
const SECOND_SIGNATURE = "Rh18WpUe1wkT8bV8eVev7uTg1SY4jf1tRqdjo6c6Zufmtqbs5n99Yq6kJ3HzLLnxXKdtcKuwjKhWPpQx5E3Cqu6";
const CREATED_AT_MS = String((1_000_000 + 1000) * 1000);
const SYSTEM = "11111111111111111111111111111111";
const SECRET = "do-not-print-this-private-key";

function chain(patch: Partial<Chain> = {}): Chain & { submits: number } {
  const seen = { submits: 0 };
  const base: Chain = {
    async account() {
      return { lamports: "280727692", owner: SYSTEM, data: new Uint8Array() };
    },
    async rent() {
      return "890880";
    },
    async mint() {
      return null;
    },
    async holders() {
      return null;
    },
    async slot() {
      return "5000";
    },
    async blockTime(slot) {
      return 1_000_000 + Number(slot);
    },
    async blockhash() {
      return "2".repeat(43);
    },
    async blockhashValid() {
      return "unknown";
    },
    async market() {
      return null;
    },
    async submit() {
      seen.submits += 1;
      throw new Error("legacy recovery CLI must not broadcast");
    },
    async signatureState() {
      return "absent";
    },
    async transaction() {
      return null;
    },
  };
  const value = Object.assign(base, patch);
  value.submit = async () => {
    seen.submits += 1;
    throw new Error("legacy recovery CLI must not broadcast");
  };
  Object.defineProperty(value, "submits", { get: () => seen.submits });
  return value as Chain & { submits: number };
}

function fixture(suspended = true) {
  const parent: RegisteredParent = {
    id: "00000000-0000-4000-8000-000000000001",
    scope: "test",
    symbol: "TREST",
    mintAddress: MINT,
    deployerAddress: DEPLOYER,
    feeRecipientAddress: DEPLOYER,
    feeMode: "single_recipient",
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 6,
    graduated: false,
    quoteMintAddress: SYSTEM,
    eligible: true,
  };
  const store = memoryStore({
    parent,
    control: { suspended, reserveLamports: "5000000", cycleCapLamports: "100000000", slippageBps: 100 },
  });
  return { store, chain: chain() };
}

async function seed(store: ReturnType<typeof fixture>["store"], key: string, signature: string) {
  assert.equal(await store.recordIntent({
    idempotencyKey: key,
    parentMint: MINT,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: null,
    createdAtMs: CREATED_AT_MS,
  }), "ok");
  assert.equal(await store.markIntent(MINT, "test", key, "submitted", signature), "ok");
  assert.equal(await store.markIntent(MINT, "test", key, "uncertain", signature), "ok");
}

function env(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    TREST_LEGACY_RECOVERY_AUTHORIZED: "true",
    REWARDS_LOOP_ENABLED: "false",
    REWARDS_EXECUTION_AUTHORIZED: "false",
    TREST_SIGNER_SUSPENDED: "true",
    TREST_DEPLOYER_ADDRESS: DEPLOYER,
    DATABASE_URL: "postgres://operator.invalid/rewards",
    HELIUS_RPC_URL: "https://operator.invalid",
    TREST_DEPLOYER_PRIVATE_KEY: SECRET,
    SDK_DEPLOYER_PRIVATE_KEY: SECRET,
    KILL_WALLET: SECRET,
    ...patch,
  };
}

function command(intent = FIRST, patch: { operator?: string; reason?: string; approval?: string } = {}): string[] {
  return [
    "node",
    "legacy-recovery-cli.ts",
    "--intent",
    intent,
    "--operator",
    patch.operator ?? "operator-1",
    "--reason",
    patch.reason ?? "The signed blockhash window has elapsed and the signature is absent.",
    "--approval",
    patch.approval ?? "TREST-07F-LEGACY-RECOVERY",
  ];
}

function io(envFixture = fixture()): RecoveryIo {
  return { store: envFixture.store, chain: envFixture.chain };
}

function safe(out: string) {
  assert.equal(out.includes(SECRET), false);
  assert.equal(out.includes("postgres://"), false);
  assert.equal(out.includes("https://"), false);
}

test("each exact legacy intent is accepted once and a repeat is duplicate", async () => {
  for (const [key, signature] of [[FIRST, FIRST_SIGNATURE], [SECOND, SECOND_SIGNATURE]] as const) {
    const current = fixture();
    await seed(current.store, key, signature);
    const accepted = await cliMain(command(key), env(), io(current));
    assert.equal(accepted.code, 0);
    assert.equal(accepted.out, "ok");
    safe(accepted.out);
    assert.equal(current.chain.submits, 0);
    const stored = (await current.store.intents(MINT, "test")).find((intent) => intent.idempotencyKey === key);
    assert.equal(stored?.status, "uncertain");
    assert.equal((await current.store.legacyRecoveries(MINT, "test")).length, 1);
    const repeated = await cliMain(command(key), env(), io(current));
    assert.equal(repeated.code, 0);
    assert.equal(repeated.out, "duplicate");
    safe(repeated.out);
    assert.equal((await current.store.legacyRecoveries(MINT, "test")).length, 1);
    assert.equal(current.chain.submits, 0);
  }
});

test("the recovery CLI rejects unauthorised, mismatched, and incomplete requests", async () => {
  const current = fixture();
  await seed(current.store, FIRST, FIRST_SIGNATURE);
  await seed(current.store, SECOND, SECOND_SIGNATURE);
  const cases: Array<[string[], Record<string, string | undefined>, string]> = [
    [command(), env({ TREST_LEGACY_RECOVERY_AUTHORIZED: undefined }), "rejected authorisation"],
    [command(FIRST, { approval: "approve" }), env(), "rejected approval"],
    [command("collect-not-legacy-0001"), env(), "rejected intent"],
    [command(), env({ TREST_DEPLOYER_ADDRESS: "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1" }), "rejected deployer"],
    [command(FIRST, { operator: "bad operator" }), env(), "rejected operator"],
    [command(FIRST, { operator: "x".repeat(81) }), env(), "rejected operator"],
    [command(FIRST, { reason: " " }), env(), "rejected reason"],
    [command(FIRST, { reason: "x".repeat(241) }), env(), "rejected reason"],
    [["node", "legacy-recovery-cli.ts", "--intent", FIRST, "--mint", MINT], env(), "rejected argument"],
    [["node", "legacy-recovery-cli.ts", "--signature", FIRST_SIGNATURE, "--intent", FIRST, "--operator", "operator-1", "--reason", "reason", "--approval", "TREST-07F-LEGACY-RECOVERY"], env(), "rejected argument"],
  ];
  for (const [argv, environment, expected] of cases) {
    const result = await cliMain(argv, environment, io(current));
    assert.equal(result.out, expected);
    assert.equal(result.code, 2);
    safe(result.out);
  }
  assert.equal((await current.store.legacyRecoveries(MINT, "test")).length, 0);
  assert.equal(current.chain.submits, 0);
});

test("insufficient chain evidence and an unsuspended worker are rejected without a broadcast", async () => {
  const weak = fixture();
  await seed(weak.store, FIRST, FIRST_SIGNATURE);
  weak.chain.signatureState = async () => "unknown";
  const evidence = await cliMain(command(), env(), io(weak));
  assert.equal(evidence.out, "rejected evidence");
  assert.equal(evidence.code, 2);
  assert.equal(weak.chain.submits, 0);
  assert.equal((await weak.store.legacyRecoveries(MINT, "test")).length, 0);

  const active = fixture(false);
  await seed(active.store, FIRST, FIRST_SIGNATURE);
  const database = await cliMain(command(), env(), io(active));
  assert.equal(database.out, "rejected suspended");
  const enabled = await cliMain(command(), env({ REWARDS_LOOP_ENABLED: "true" }), io(fixture()));
  const authorised = await cliMain(command(), env({ REWARDS_EXECUTION_AUTHORIZED: "true" }), io(fixture()));
  const signer = await cliMain(command(), env({ TREST_SIGNER_SUSPENDED: "false" }), io(fixture()));
  assert.equal(enabled.out, "rejected suspended");
  assert.equal(authorised.out, "rejected suspended");
  assert.equal(signer.out, "rejected suspended");
  assert.equal(active.chain.submits, 0);
});

test("the recovery CLI stays outside the worker and cannot sign", () => {
  const cli = readFileSync(new URL("./legacy-recovery-cli.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const loop = readFileSync(new URL("./loop.ts", import.meta.url), "utf8");
  assert.equal(server.includes("legacy-recovery-cli"), false);
  assert.equal(loop.includes("legacy-recovery-cli"), false);
  assert.equal(server.includes("reconcileLegacyCollection"), false);
  assert.equal(loop.includes("reconcileLegacyCollection"), false);
  assert.equal(cli.includes("signInspected"), false);
  assert.equal(cli.includes(".submit("), false);
  assert.equal(cli.includes("TREST_DEPLOYER_PRIVATE_KEY"), false);
  assert.equal(cli.includes("SDK_DEPLOYER_PRIVATE_KEY"), false);
  assert.equal(cli.includes("KILL_WALLET"), false);
});
