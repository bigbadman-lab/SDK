import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { buybackSpendAllowed } from "../../../lib/rewards/ledger.ts";
import { observeMeta, type Chain, type ObservedTransaction, type SubmitResult } from "./chain.ts";
import { CONFIRMED_COLLECTION } from "./collection-recovery.ts";
import { cliMain } from "./deferred-buyback-cli.ts";
import { DEFERRED_BUYBACK_APPROVAL, executeDeferredBuyback } from "./deferred-buyback.ts";
import { DEFERRED_BUYBACK_BUDGET, DEFERRED_BUYBACK_KEY, memoryStore, TREST_REHEARSAL_MINT, type RegisteredParent, type RewardsStore } from "./store.ts";

const START = CONFIRMED_COLLECTION.windowStartMs;
const WINDOW = 300_000;
const FLOOR = (BigInt(CONFIRMED_COLLECTION.reserve) + BigInt(CONFIRMED_COLLECTION.holders) + BigInt(CONFIRMED_COLLECTION.buyback) + BigInt(CONFIRMED_COLLECTION.deployerRetained)).toString();
const BLOCKHASH = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
const TOKENS = "42";

function parent(): RegisteredParent {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    scope: "test",
    symbol: "TREST",
    mintAddress: TREST_REHEARSAL_MINT,
    deployerAddress: CONFIRMED_COLLECTION.deployer,
    feeRecipientAddress: CONFIRMED_COLLECTION.deployer,
    feeMode: "single_recipient",
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    decimals: 6,
    graduated: false,
    quoteMintAddress: "11111111111111111111111111111111",
    eligible: true,
  };
}

function bought(spent: string, tokens: string): ObservedTransaction {
  const before = Number(FLOOR);
  const observed = observeMeta(
    {
      slot: 470000000,
      transaction: { message: { accountKeys: [CONFIRMED_COLLECTION.deployer, "11111111111111111111111111111111"] } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [before, 1],
        postBalances: [before - Number(spent), 1],
        preTokenBalances: [{ accountIndex: 0, mint: TREST_REHEARSAL_MINT, owner: CONFIRMED_COLLECTION.deployer, uiTokenAmount: { amount: "1000" } }],
        postTokenBalances: [{ accountIndex: 0, mint: TREST_REHEARSAL_MINT, owner: CONFIRMED_COLLECTION.deployer, uiTokenAmount: { amount: (BigInt(1000) + BigInt(tokens)).toString() } }],
      },
    },
    {
      creator: CONFIRMED_COLLECTION.deployer,
      solVault: CONFIRMED_COLLECTION.deployer,
      wsolVault: CONFIRMED_COLLECTION.deployer,
      parentMint: TREST_REHEARSAL_MINT,
      destination: CONFIRMED_COLLECTION.deployer,
    },
  );
  if (!observed || observed.tokenDelta !== tokens) throw new Error("token delta");
  return observed;
}

async function readyStore(): Promise<RewardsStore> {
  const store = memoryStore({
    parent: parent(),
    control: { suspended: true, reserveLamports: CONFIRMED_COLLECTION.reserve, cycleCapLamports: "100000000", slippageBps: 100 },
    rehearsal: { windowStartsMs: [START, START + WINDOW, START + WINDOW * 2] },
  });
  assert.equal((await store.claimRehearsalWindow({ parentMint: TREST_REHEARSAL_MINT, scope: "test", windowStartMs: START })).ok, true);
  assert.equal(await store.finishRehearsalWindow({ parentMint: TREST_REHEARSAL_MINT, scope: "test", windowStartMs: START, outcome: "stopped" }), "ok");
  assert.equal(await store.recordIntent({
    idempotencyKey: CONFIRMED_COLLECTION.idempotencyKey,
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: BLOCKHASH,
  }), "ok");
  assert.equal(await store.markIntent(TREST_REHEARSAL_MINT, "test", CONFIRMED_COLLECTION.idempotencyKey, "submitted", CONFIRMED_COLLECTION.signature), "ok");
  assert.equal(await store.markIntent(TREST_REHEARSAL_MINT, "test", CONFIRMED_COLLECTION.idempotencyKey, "uncertain", CONFIRMED_COLLECTION.signature), "ok");
  assert.equal(await store.commitCollectionRecovery({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    idempotencyKey: CONFIRMED_COLLECTION.idempotencyKey,
    signature: CONFIRMED_COLLECTION.signature,
    priorStatus: "uncertain",
    approval: "TREST-07J-COLLECTION-RECOVERY",
    operator: "trest-07k",
    reason: "test",
    grossLamports: CONFIRMED_COLLECTION.gross,
    feeLamports: CONFIRMED_COLLECTION.fee,
    netLamports: CONFIRMED_COLLECTION.net,
    reserveLamports: CONFIRMED_COLLECTION.reserve,
    holderLamports: CONFIRMED_COLLECTION.holders,
    buybackLamports: CONFIRMED_COLLECTION.buyback,
    deployerLamports: CONFIRMED_COLLECTION.deployerRetained,
    snapshotStatus: "historical_unavailable",
    gross: CONFIRMED_COLLECTION.gross,
    fee: CONFIRMED_COLLECTION.fee,
    native: CONFIRMED_COLLECTION.gross,
    wsolConverted: "0",
    rentExcluded: "0",
    slot: CONFIRMED_COLLECTION.slot,
    amountLamports: CONFIRMED_COLLECTION.net,
  }), "ok");
  return store;
}

function chain(state: {
  wallet: string;
  submits: number;
  submit: () => Promise<SubmitResult>;
  observed: ObservedTransaction | null;
  signatureStatus: "finalized" | "unknown";
}): Chain {
  return {
    async account(address) {
      return {
        lamports: address === CONFIRMED_COLLECTION.deployer ? state.wallet : "2039280",
        owner: "11111111111111111111111111111111",
        data: new Uint8Array(),
      };
    },
    async rent() {
      return "2039280";
    },
    async mint() {
      return null;
    },
    async holders() {
      return null;
    },
    async slot() {
      return "1";
    },
    async blockTime() {
      return null;
    },
    async blockhash() {
      return BLOCKHASH;
    },
    async latestBlockhash() {
      return { blockhash: BLOCKHASH, lastValidBlockHeight: "100" };
    },
    async blockhashValid() {
      return "valid";
    },
    async market() {
      return {
        graduated: false,
        curve: {
          virtualTokenReserves: "1000000000",
          virtualQuoteReserves: "1000000000",
          realTokenReserves: "1000000000",
          realQuoteReserves: "0",
          tokenTotalSupply: "1000000000",
          complete: false,
          creator: CONFIRMED_COLLECTION.deployer,
        },
      };
    },
    async submit() {
      state.submits += 1;
      return state.submit();
    },
    async signatureState() {
      return "present";
    },
    async signatureStatus() {
      return state.signatureStatus;
    },
    async transaction() {
      return state.observed;
    },
    async pace() {
      return undefined;
    },
  };
}

function signature(): string {
  return bs58.encode(nacl.sign.detached(new Uint8Array(32), nacl.sign.keyPair().secretKey));
}

function run(store: RewardsStore, rpc: Chain) {
  return executeDeferredBuyback({
    authorised: true,
    approval: DEFERRED_BUYBACK_APPROVAL,
    secret: "test-secret",
    store,
    chain: rpc,
    sign: () => ({ ok: true, signature: signature() }),
  });
}

test("the reserved buyback spends its own budget once and leaves holder funds protected", async () => {
  const store = await readyStore();
  const state = {
    wallet: FLOOR,
    submits: 0,
    submit: async (): Promise<SubmitResult> => ({ status: "accepted" }),
    observed: bought(DEFERRED_BUYBACK_BUDGET, TOKENS),
    signatureStatus: "finalized" as const,
  };
  const stacked = buybackSpendAllowed({
    walletLamports: FLOOR,
    buybackLamports: DEFERRED_BUYBACK_BUDGET,
    reserveLamports: CONFIRMED_COLLECTION.reserve,
    unpaidHolderLamports: "0",
    deployerRetainedLamports: "0",
    unspentPriorBuybackLamports: "0",
    deferredHolderLamports: CONFIRMED_COLLECTION.holders,
    deferredBuybackLamports: DEFERRED_BUYBACK_BUDGET,
    deferredDeployerLamports: CONFIRMED_COLLECTION.deployerRetained,
  });
  assert.equal(stacked.ok, false);
  const first = await run(store, chain(state));
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;
  assert.equal(first.duplicate, false);
  assert.equal(first.solSpent, DEFERRED_BUYBACK_BUDGET);
  assert.equal(first.tokenAmount, TOKENS);
  assert.equal(state.submits, 1);
  const obligations = await store.solObligations(TREST_REHEARSAL_MINT, "test");
  assert.equal(obligations.deferredBuybackLamports, "0");
  assert.equal(obligations.deferredHolderLamports, CONFIRMED_COLLECTION.holders);
  assert.equal(obligations.deferredDeployerLamports, CONFIRMED_COLLECTION.deployerRetained);
  assert.equal(obligations.holderSol, "0");
  const buybacks = (await store.intents(TREST_REHEARSAL_MINT, "test")).filter((intent) => intent.kind === "buyback");
  assert.equal(buybacks.length, 1);
  assert.equal(buybacks[0]?.status, "confirmed");
  assert.equal(buybacks[0]?.tokenAmount, TOKENS);
  assert.equal((await store.snapshots(TREST_REHEARSAL_MINT, "test", `test:${TREST_REHEARSAL_MINT}:${START}`)).length, 0);
  assert.equal((await store.control(TREST_REHEARSAL_MINT, "test"))?.suspended, true);
  const again = await run(store, chain(state));
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.duplicate, true);
  assert.equal(state.submits, 1);
});

test("a short wallet and an open rehearsal do not reserve the buyback", async () => {
  const short = await readyStore();
  const state = {
    wallet: (BigInt(FLOOR) - BigInt(1)).toString(),
    submits: 0,
    submit: async (): Promise<SubmitResult> => ({ status: "accepted" }),
    observed: bought(DEFERRED_BUYBACK_BUDGET, TOKENS),
    signatureStatus: "finalized" as const,
  };
  const blocked = await run(short, chain(state));
  assert.deepEqual(blocked, { ok: false, code: "unfunded" });
  assert.equal((await short.intents(TREST_REHEARSAL_MINT, "test")).some((intent) => intent.kind === "buyback"), false);
  const open = memoryStore({
    parent: parent(),
    control: { suspended: true, reserveLamports: CONFIRMED_COLLECTION.reserve, cycleCapLamports: "100000000", slippageBps: 100 },
    rehearsal: { windowStartsMs: [START, START + WINDOW, START + WINDOW * 2] },
  });
  const rehearsal = await run(open, chain({ ...state, wallet: FLOOR }));
  assert.deepEqual(rehearsal, { ok: false, code: "rehearsal" });
  const other = memoryStore({
    parent: { ...parent(), mintAddress: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse" },
    control: { suspended: true, reserveLamports: CONFIRMED_COLLECTION.reserve, cycleCapLamports: "100000000", slippageBps: 100 },
  });
  assert.deepEqual(await run(other, chain({ ...state, wallet: FLOOR })), { ok: false, code: "parent" });
});

test("an uncertain buyback is reconciled once and a failed buyback does not keep the budget", async () => {
  const store = await readyStore();
  const state = {
    wallet: FLOOR,
    submits: 0,
    submit: async (): Promise<SubmitResult> => ({ status: "accepted" }),
    observed: null as ObservedTransaction | null,
    signatureStatus: "unknown" as "finalized" | "unknown",
  };
  const pending = await run(store, chain(state));
  assert.deepEqual(pending, { ok: false, code: "uncertain" });
  assert.equal(state.submits, 1);
  assert.equal((await store.solObligations(TREST_REHEARSAL_MINT, "test")).deferredBuybackLamports, DEFERRED_BUYBACK_BUDGET);
  const replay = await run(store, chain(state));
  assert.deepEqual(replay, { ok: false, code: "uncertain" });
  assert.equal(state.submits, 1);
  state.observed = bought(DEFERRED_BUYBACK_BUDGET, TOKENS);
  state.signatureStatus = "finalized";
  const settled = await run(store, chain(state));
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  assert.equal(settled.tokenAmount, TOKENS);
  assert.equal(state.submits, 1);
  const failedStore = await readyStore();
  const failedState = {
    wallet: FLOOR,
    submits: 0,
    submit: async (): Promise<SubmitResult> => ({ status: "preflight", code: "preflight", detail: "rejected" }),
    observed: bought(DEFERRED_BUYBACK_BUDGET, TOKENS),
    signatureStatus: "finalized" as const,
  };
  assert.deepEqual(await run(failedStore, chain(failedState)), { ok: false, code: "failed" });
  assert.equal((await failedStore.solObligations(TREST_REHEARSAL_MINT, "test")).deferredBuybackLamports, DEFERRED_BUYBACK_BUDGET);
  failedState.submit = async () => ({ status: "accepted" });
  const retried = await run(failedStore, chain(failedState));
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.duplicate, false);
  assert.equal(failedState.submits, 2);
  assert.equal((await failedStore.intents(TREST_REHEARSAL_MINT, "test")).filter((intent) => intent.kind === "buyback" && intent.status === "confirmed").length, 1);
  assert.equal((await failedStore.solObligations(TREST_REHEARSAL_MINT, "test")).deferredHolderLamports, CONFIRMED_COLLECTION.holders);
});

test("a second worker cannot buy the same reserved allocation", async () => {
  const store = await readyStore();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const state = {
    wallet: FLOOR,
    submits: 0,
    submit: async (): Promise<SubmitResult> => {
      entered += 1;
      if (entered === 1) await gate;
      return { status: "accepted" };
    },
    observed: bought(DEFERRED_BUYBACK_BUDGET, TOKENS),
    signatureStatus: "finalized" as const,
  };
  const rpc = chain(state);
  const first = run(store, rpc);
  const started = Date.now();
  while (entered < 1 && Date.now() - started < 2000) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(entered, 1);
  const second = await run(store, rpc);
  assert.deepEqual(second, { ok: false, code: "locked" });
  release();
  const settled = await first;
  assert.equal(settled.ok, true);
  assert.equal(state.submits, 1);
  assert.equal((await store.intents(TREST_REHEARSAL_MINT, "test")).filter((intent) => intent.idempotencyKey === DEFERRED_BUYBACK_KEY).length, 1);
});

test("the deferred buyback command stays outside the worker process", async () => {
  const server = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const loop = await readFile(new URL("./loop.ts", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.equal(server.includes("deferred-buyback"), false);
  assert.equal(loop.includes("deferred-buyback"), false);
  assert.match(manifest, /"deferred-buyback":/);
  const env = {
    TREST_DEFERRED_BUYBACK_AUTHORIZED: "true",
    TREST_DEPLOYER_ADDRESS: CONFIRMED_COLLECTION.deployer,
    REWARDS_LOOP_ENABLED: "false",
    REWARDS_EXECUTION_AUTHORIZED: "false",
    TREST_SIGNER_SUSPENDED: "true",
  };
  const command = ["node", "deferred-buyback-cli.ts", "--operator", "trest", "--reason", "buy the reserved allocation", "--approval", DEFERRED_BUYBACK_APPROVAL];
  assert.equal((await cliMain(command, { ...env, TREST_DEFERRED_BUYBACK_AUTHORIZED: "false" })).out, "rejected authorisation");
  assert.equal((await cliMain(command, { ...env, REWARDS_LOOP_ENABLED: "true" })).out, "rejected suspended");
  assert.equal((await cliMain(command, env, { store: await readyStore(), chain: chain({
    wallet: FLOOR,
    submits: 0,
    submit: async () => ({ status: "accepted" }),
    observed: bought(DEFERRED_BUYBACK_BUDGET, TOKENS),
    signatureStatus: "finalized",
  }) })).out, "rejected signer_mismatch");
});
