import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { TREST_MINT, TOKEN_2022_PROGRAM } from "../../../lib/launch/verified-launch.ts";
import { claimAuthorizationMessage } from "../../../lib/rewards/ownership.ts";
import type { CanonicalParentConfig } from "../../../lib/rewards/production.ts";
import { creatorVaultAddress, type Chain } from "./chain.ts";
import { runProductionCycle, submitClaim } from "./run.ts";
import { memoryStore, type RegisteredParent, type RewardsStore } from "./store.ts";

const MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SYSTEM = "11111111111111111111111111111111";
const NOW = Date.UTC(2026, 9, 26, 16, 0, 0);
const LEASE_MS = 5 * 60 * 1000;

function signer(): { secret: string; address: string } {
  const pair = nacl.sign.keyPair();
  return { secret: bs58.encode(pair.secretKey), address: new PublicKey(pair.publicKey).toBase58() };
}

function parentFor(deployer: string, patch: Partial<RegisteredParent> = {}): RegisteredParent {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    scope: "production",
    symbol: "SDK",
    mintAddress: MINT,
    deployerAddress: deployer,
    feeRecipientAddress: deployer,
    feeMode: "single_recipient",
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    graduated: false,
    quoteMintAddress: SYSTEM,
    eligible: true,
    ...patch,
  };
}

function configFor(patch: Partial<CanonicalParentConfig> = {}): CanonicalParentConfig {
  return { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true, ...patch };
}

function chainFor(deployer: string, holder: string, vaultLamports = "0"): { chain: Chain; submits: number; reads: { mint: number } } {
  const submits: Uint8Array[] = [];
  const reads = { mint: 0 };
  const vault = creatorVaultAddress(deployer);
  const chain: Chain = {
    async account(address) {
      if (address === deployer) return { lamports: "5000000000", owner: SYSTEM, data: new Uint8Array() };
      if (vault && address === vault && vaultLamports !== "0") return { lamports: vaultLamports, owner: SYSTEM, data: new Uint8Array() };
      return null;
    },
    async rent() {
      return "890880";
    },
    async mint() {
      reads.mint += 1;
      return { decimals: 6, tokenProgram: TOKEN_2022_PROGRAM };
    },
    async holders() {
      return { observedSlot: "44", accounts: [{ owner: holder, mint: MINT, amount: "50000000000" }] };
    },
    async slot() {
      return "44";
    },
    async blockTime() {
      return null;
    },
    async blockhash() {
      return new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
    },
    async blockhashValid() {
      return "valid";
    },
    async market() {
      return null;
    },
    async submit(wire) {
      submits.push(wire);
      return { status: "accepted" };
    },
    async signatureState() {
      return "absent";
    },
    async transaction() {
      return null;
    },
    async solClaim() {
      return { status: "confirmed", feeLamports: "5000" };
    },
    async pace() {},
  };
  return {
    chain,
    get submits() {
      return submits.length;
    },
    reads,
  };
}

function scoped(store: RewardsStore): RewardsStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (args.includes("test")) throw new Error("test scope");
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function cycleInput(env: {
  key: { secret: string; address: string };
  holder: string;
  store: RewardsStore;
  chain: Chain;
  parent: RegisteredParent | null;
  config: CanonicalParentConfig | null;
}, patch: { suspended?: boolean; authorised?: boolean; shuttingDown?: boolean; holder?: string; expectedAddress?: string } = {}) {
  return {
    nowMs: NOW,
    holder: patch.holder ?? "worker-a",
    loopEnabled: true,
    authorised: patch.authorised ?? true,
    suspended: patch.suspended ?? false,
    secret: env.key.secret,
    expectedAddress: patch.expectedAddress ?? env.key.address,
    shuttingDown: patch.shuttingDown ?? false,
    parent: env.parent,
    config: env.config,
    store: env.store,
    chain: env.chain,
  };
}

test("production resolution fails closed without a mint, on mismatch, and for TREST", async () => {
  const key = signer();
  const holder = signer();
  const observed = chainFor(key.address, holder.address);
  const absent = memoryStore({
    parent: parentFor(key.address),
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  });
  const unregistered = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store: scoped(absent),
    chain: observed.chain,
    parent: null,
    config: null,
  }));
  assert.equal(unregistered.ok, false);
  if (!unregistered.ok) assert.equal(unregistered.code, "parent");
  const mismatched = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store: scoped(absent),
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor({ mint: OTHER }),
  }));
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.code, "parent");
  const historical = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store: scoped(absent),
    chain: observed.chain,
    parent: parentFor(key.address, { scope: "test", symbol: "TREST", mintAddress: TREST_MINT }),
    config: configFor({ mint: TREST_MINT }),
  }));
  assert.equal(historical.ok, false);
  if (!historical.ok) assert.equal(historical.code, "parent");
  assert.equal(observed.reads.mint, 0);
  assert.equal(observed.submits, 0);
  assert.equal((await absent.windows(MINT, "production")).length, 0);
});

test("a signer mismatch, a suspended signer, and inactive rewards do not broadcast", async () => {
  const key = signer();
  const holder = signer();
  const observed = chainFor(key.address, holder.address);
  const store = scoped(memoryStore({
    parent: parentFor(key.address),
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  }));
  const mismatch = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  }, { expectedAddress: OTHER }));
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "signer_mismatch");
  const suspended = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  }, { suspended: true }));
  assert.equal(suspended.ok, false);
  if (!suspended.ok) assert.equal(suspended.code, "inactive");
  const inactive = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor({ rewardsActive: false }),
  }));
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.equal(inactive.code, "inactive");
  const stopped = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  }, { shuttingDown: true }));
  assert.equal(stopped.ok, false);
  if (!stopped.ok) assert.equal(stopped.code, "inactive");
  assert.equal(observed.submits, 0);
  assert.equal(observed.reads.mint, 0);
});

test("a production five-minute window allocates 50 percent to holders and leaves test rows untouched", async () => {
  const key = signer();
  const holder = signer();
  const observed = chainFor(key.address, holder.address);
  const store = scoped(memoryStore({
    parent: parentFor(key.address),
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  }));
  assert.equal(await store.saveReceipt({
    signature: "3".repeat(88),
    parentMint: MINT,
    scope: "production",
    amountLamports: "1000000",
    slot: "44",
    confirmed: true,
    source: "creator_vault",
    gross: "1000000",
    fee: "0",
    native: "1000000",
    wsolConverted: "0",
    rentExcluded: "0",
  }), "ok");
  const result = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.tokenCredited, "0");
  const windows = await store.windows(MINT, "production");
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.holders, "500000");
  assert.equal(windows[0]?.buyback, "0");
  assert.equal(windows[0]?.deployer, "500000");
  const snaps = await store.snapshots(MINT, "production", `production:${MINT}:${NOW}`);
  assert.equal(snaps[0]?.owner, holder.address);
  assert.equal(snaps[0]?.solLamports, "500000");
  assert.equal(observed.submits, 0);
});

test("an overlapping tick cannot take the lease, and an expired lease can be recovered", async () => {
  const key = signer();
  const holder = signer();
  const observed = chainFor(key.address, holder.address);
  const store = memoryStore({
    parent: parentFor(key.address),
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  });
  const deferred = { resolve: () => undefined as void };
  const gate = new Promise<void>((resolve) => {
    deferred.resolve = () => resolve();
  });
  const blocked = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "allocateUnallocated" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        await gate;
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const env = {
    key,
    holder: holder.address,
    store: blocked,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  };
  const first = runProductionCycle(cycleInput(env, { holder: "worker-a" }));
  const second = runProductionCycle(cycleInput(env, { holder: "worker-b" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  deferred.resolve();
  const results = await Promise.all([first, second]);
  const codes = results.map((result) => result.ok ? "ok" : result.code).sort();
  assert.deepEqual(codes, ["locked", "ok"]);
  assert.equal(await store.tryLock(MINT, "production", "worker-a", NOW), "ok");
  assert.equal(await store.tryLock(MINT, "production", "worker-a", NOW + 1), "locked");
  assert.equal(await store.tryLock(MINT, "production", "worker-b", NOW + LEASE_MS - 1), "locked");
  assert.equal(await store.tryLock(MINT, "production", "worker-c", NOW + LEASE_MS), "ok");
});

test("a production holder claim pays the entitled wallet and refuses an inactive or suspended signer", async () => {
  const key = signer();
  const holder = signer();
  const observed = chainFor(key.address, holder.address);
  const store = memoryStore({
    parent: parentFor(key.address),
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  });
  assert.equal(await store.saveReceipt({
    signature: "4".repeat(88),
    parentMint: MINT,
    scope: "production",
    amountLamports: "1000000",
    slot: "44",
    confirmed: true,
    source: "creator_vault",
    gross: "1000000",
    fee: "0",
    native: "1000000",
    wsolConverted: "0",
    rentExcluded: "0",
  }), "ok");
  const processed = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  }));
  assert.equal(processed.ok, true);
  const message = claimAuthorizationMessage({
    scope: "production",
    parentMint: MINT,
    claimant: holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-holder-0001",
    amount: "500000",
  });
  assert.ok(message);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), bs58.decode(holder.secret)));
  const claim = {
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: key.secret,
    expectedAddress: key.address,
    scope: "production" as const,
    parentMint: MINT,
    claimant: holder.address,
    asset: "sol" as const,
    amount: "500000",
    idempotencyKey: "claim-sol-holder-0001",
    message,
    signature,
    domain: "sdk.fund",
    store,
    chain: observed.chain,
  };
  const inactiveMessage = claimAuthorizationMessage({
    scope: "production",
    parentMint: MINT,
    claimant: holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-holder-0002",
    amount: "500000",
  });
  assert.ok(inactiveMessage);
  const inactive = await submitClaim({
    ...claim,
    rewardsActive: false,
    idempotencyKey: "claim-sol-holder-0002",
    message: inactiveMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(inactiveMessage), bs58.decode(holder.secret))),
  });
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.equal(inactive.code, "inactive");
  const suspended = await submitClaim({ ...claim, suspended: true, rewardsActive: true, idempotencyKey: "claim-sol-holder-0003" });
  assert.equal(suspended.ok, false);
  if (!suspended.ok) assert.equal(suspended.code, "inactive");
  const paid = await submitClaim({ ...claim, rewardsActive: true });
  assert.equal(paid.ok, true);
  if (!paid.ok) return;
  assert.equal(typeof paid.signature, "string");
  const replay = await submitClaim({ ...claim, rewardsActive: true });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.code, "duplicate");
  const stranger = signer();
  const payerMessage = claimAuthorizationMessage({
    scope: "production",
    parentMint: MINT,
    claimant: holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-holder-0004",
    amount: "1",
  });
  assert.ok(payerMessage);
  const wrongPayer = await submitClaim({
    ...claim,
    rewardsActive: true,
    amount: "1",
    idempotencyKey: "claim-sol-holder-0004",
    message: payerMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(payerMessage), bs58.decode(holder.secret))),
    secret: stranger.secret,
  });
  assert.equal(wrongPayer.ok, false);
  if (!wrongPayer.ok) assert.equal(wrongPayer.code, "signer_mismatch");
  const wrongDestination = await submitClaim({
    ...claim,
    rewardsActive: true,
    claimant: stranger.address,
    idempotencyKey: "claim-sol-holder-0005",
    message: claimAuthorizationMessage({
      scope: "production",
      parentMint: MINT,
      claimant: stranger.address,
      asset: "sol",
      idempotencyKey: "claim-sol-holder-0005",
      amount: "500000",
    }) ?? "",
    signature,
  });
  assert.equal(wrongDestination.ok, false);
  if (!wrongDestination.ok) assert.equal(wrongDestination.code, "ownership");
  assert.equal(observed.submits, 1);
});

test("an unsigned production intent is not broadcast again after the lease can be recovered", async () => {
  const key = signer();
  const holder = signer();
  const observed = chainFor(key.address, holder.address, "2000000");
  const store = memoryStore({
    parent: parentFor(key.address),
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  });
  assert.equal(await store.recordIntent({
    idempotencyKey: `collect-${NOW}`,
    parentMint: MINT,
    scope: "production",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
  }), "ok");
  const first = await store.tryLock(MINT, "production", "worker-a", NOW);
  assert.equal(first, "ok");
  assert.equal(await store.tryLock(MINT, "production", "worker-b", NOW + 1), "locked");
  assert.equal(await store.tryLock(MINT, "production", "worker-b", NOW + LEASE_MS), "ok");
  await store.unlock(MINT, "production", "worker-b");
  const recovered = await runProductionCycle(cycleInput({
    key,
    holder: holder.address,
    store,
    chain: observed.chain,
    parent: parentFor(key.address),
    config: configFor(),
  }, { holder: "worker-c" }));
  assert.equal(recovered.ok, false);
  if (!recovered.ok) assert.equal(recovered.code, "uncertain");
  assert.equal(observed.submits, 0);
  const intents = await store.intents(MINT, "production");
  assert.equal(intents.filter((intent) => intent.idempotencyKey === `collect-${NOW}`).length, 1);
});

test("the worker lease, shutdown, and production loop stay fail closed in source", () => {
  const lock = readFileSync(new URL("./postgres.ts", import.meta.url), "utf8");
  const lease = lock.slice(lock.indexOf("async tryLock"), lock.indexOf("async unlock"));
  assert.equal(lease.includes("where reward_cycle_locks.expires_at <= now()"), true);
  assert.equal(lease.includes("holder = excluded.holder or"), false);
  const broadcast = readFileSync(new URL("./run.ts", import.meta.url), "utf8");
  const body = broadcast.slice(broadcast.indexOf("async function broadcast"), broadcast.indexOf("async function skipMissedRehearsalWindows"));
  const claimBody = broadcast.slice(broadcast.indexOf("export async function submitClaim"), broadcast.indexOf("async function confirmedSignatureUsed"));
  assert.ok(body.lastIndexOf("shutdownRequested()") < body.lastIndexOf("input.chain.submit"));
  assert.ok(claimBody.lastIndexOf("shutdownRequested()") < claimBody.lastIndexOf("input.chain.submit"));
  const loop = readFileSync(new URL("./loop.ts", import.meta.url), "utf8");
  assert.equal(loop.includes("instanceHolder()"), true);
  assert.equal(loop.includes("beginTick()"), true);
  assert.equal(loop.includes("endTick()"), true);
  assert.equal(loop.includes("SIGTERM") || readFileSync(new URL("./server.ts", import.meta.url), "utf8").includes("SIGTERM"), true);
  const production = readFileSync(new URL("./production-loop.ts", import.meta.url), "utf8");
  assert.equal(production.includes("scope = 'production'"), true);
  assert.equal(production.includes("parent_scope = 'test'"), false);
  assert.equal(production.includes("SDK_DEPLOYER_PRIVATE_KEY"), false);
});
