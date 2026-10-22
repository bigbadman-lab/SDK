import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { planIncrementalAllocation } from "../../../lib/rewards/ledger.ts";
import { classifySignatureStatus, pollTransactionConfirmation, type Chain, type ObservedTransaction } from "./chain.ts";
import { cliMain } from "./collection-recovery-cli.ts";
import {
  COLLECTION_RECOVERY_APPROVAL,
  CONFIRMED_COLLECTION,
  buybackRecoveryAuthorisation,
  historicalHolderSnapshot,
  plannedCollectionAllocation,
  recoverConfirmedCollection,
} from "./collection-recovery.ts";
import { admitNextRehearsal, memoryStore, TREST_REHEARSAL_MINT, type RegisteredParent } from "./store.ts";

const WINDOW = 300_000;
const START = CONFIRMED_COLLECTION.windowStartMs;

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

function observed(patch: Partial<ObservedTransaction> = {}): ObservedTransaction {
  return {
    status: "confirmed",
    slot: CONFIRMED_COLLECTION.slot,
    feeLamports: CONFIRMED_COLLECTION.fee,
    feePayer: CONFIRMED_COLLECTION.deployer,
    nativeVaultOut: CONFIRMED_COLLECTION.gross,
    creatorDelta: CONFIRMED_COLLECTION.net,
    wsolTokenOut: "0",
    wsolClosedLamports: "0",
    wsolRentLamports: "0",
    tokenDelta: "0",
    destinationDelta: CONFIRMED_COLLECTION.net,
    destinationTokenDelta: "0",
    ...patch,
  };
}

function chain(patch?: {
  balance?: string;
  status?: "finalized" | "confirmed" | "absent";
  observed?: ObservedTransaction | null;
  identity?: { instruction: string; programId: string; accounts: string[] } | null;
}): { chain: Chain; submitsSeen: number; holderReads: number } {
  const state = { submits: 0, holders: 0 };
  const rpc: Chain = {
    async account() {
      return { lamports: patch?.balance ?? "365867999", owner: "11111111111111111111111111111111", data: new Uint8Array() };
    },
    async rent() {
      return "890880";
    },
    async mint() {
      return null;
    },
    async holders() {
      state.holders += 1;
      return { observedSlot: CONFIRMED_COLLECTION.slot, accounts: [{ owner: "holder", mint: TREST_REHEARSAL_MINT, amount: "1" }] };
    },
    async slot() {
      return CONFIRMED_COLLECTION.slot;
    },
    async blockTime() {
      return null;
    },
    async blockhash() {
      return "6AzdU5tprEwhtmLauGwX7Qq3Vz63myGxEEavua6yws7e";
    },
    async blockhashValid() {
      return "unknown";
    },
    async market() {
      return null;
    },
    async submit() {
      state.submits += 1;
      return { status: "accepted" };
    },
    async signatureState() {
      return "present";
    },
    async signatureStatus() {
      return patch?.status ?? "finalized";
    },
    async transaction() {
      return patch?.observed === undefined ? observed() : patch.observed;
    },
    async collectionIdentity() {
      if (patch && "identity" in patch) return patch.identity ?? null;
      return {
        instruction: CONFIRMED_COLLECTION.instruction,
        programId: CONFIRMED_COLLECTION.programId,
        accounts: [...CONFIRMED_COLLECTION.accounts],
      };
    },
  };
  return {
    chain: rpc,
    get submitsSeen() { return state.submits; },
    get holderReads() { return state.holders; },
  };
}

async function stoppedStore() {
  const store = memoryStore({
    parent: parent(),
    control: { suspended: false, reserveLamports: CONFIRMED_COLLECTION.reserve, cycleCapLamports: "100000000", slippageBps: 100 },
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
    recentBlockhash: "6AzdU5tprEwhtmLauGwX7Qq3Vz63myGxEEavua6yws7e",
  }), "ok");
  assert.equal(await store.markIntent(TREST_REHEARSAL_MINT, "test", CONFIRMED_COLLECTION.idempotencyKey, "submitted", CONFIRMED_COLLECTION.signature), "ok");
  assert.equal(await store.markIntent(TREST_REHEARSAL_MINT, "test", CONFIRMED_COLLECTION.idempotencyKey, "uncertain", CONFIRMED_COLLECTION.signature), "ok");
  return store;
}

const recoveryInput = {
  authorised: true,
  approval: COLLECTION_RECOVERY_APPROVAL,
  operator: "trest-07j",
  reason: "confirmed collection had no receipt",
};

test("confirmation polling treats absence as pending and a later read as confirmed", async () => {
  let reads = 0;
  const result = await pollTransactionConfirmation({
    delays: [0, 1, 1],
    wait: async () => undefined,
    status: async () => (reads < 2 ? "processed" : "finalized"),
    read: async () => {
      reads += 1;
      return reads < 3 ? null : observed();
    },
  });
  assert.equal(result.kind, "observed");
  if (result.kind !== "observed") return;
  assert.equal(result.observed.status, "confirmed");
  assert.equal(reads, 3);
});

test("a confirmed signature error is failed and a timeout is not", async () => {
  const failed = await pollTransactionConfirmation({
    delays: [0],
    wait: async () => undefined,
    status: async () => "failed",
    read: async () => null,
  });
  assert.equal(failed.kind, "failed");
  const pending = await pollTransactionConfirmation({
    delays: [0, 0],
    wait: async () => undefined,
    status: async () => "unknown",
    read: async () => null,
  });
  assert.equal(pending.kind, "pending");
  assert.equal(classifySignatureStatus({ value: [null] }), "absent");
  assert.equal(classifySignatureStatus({ value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] }), "failed");
});

test("the confirmed collection recovers one receipt and does not allocate or buy", async () => {
  const store = await stoppedStore();
  const rpc = chain();
  const first = await recoverConfirmedCollection({ ...recoveryInput, store, chain: rpc.chain });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.duplicate, false);
  assert.equal(first.net, CONFIRMED_COLLECTION.net);
  const receipts = await store.receipts(TREST_REHEARSAL_MINT, "test");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.amountLamports, CONFIRMED_COLLECTION.net);
  assert.equal(receipts[0]?.slot, CONFIRMED_COLLECTION.slot);
  const obligations = await store.solObligations(TREST_REHEARSAL_MINT, "test");
  assert.equal(obligations.holderSol, "0");
  assert.equal(obligations.buybackSol, "0");
  assert.equal(obligations.deployerRetained, "0");
  assert.equal(obligations.deferredHolderLamports, CONFIRMED_COLLECTION.holders);
  assert.equal(obligations.deferredBuybackLamports, CONFIRMED_COLLECTION.buyback);
  assert.equal(obligations.deferredDeployerLamports, CONFIRMED_COLLECTION.deployerRetained);
  const intent = (await store.intents(TREST_REHEARSAL_MINT, "test")).find((row) => row.idempotencyKey === CONFIRMED_COLLECTION.idempotencyKey);
  assert.equal(intent?.status, "confirmed");
  assert.equal(intent?.signature, CONFIRMED_COLLECTION.signature);
  const allocated = await store.allocateUnallocated({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    windowKey: `test:${TREST_REHEARSAL_MINT}:${START}`,
    reserveLamports: CONFIRMED_COLLECTION.reserve,
  });
  assert.deepEqual(allocated, { ok: true, state: "empty" });
  assert.equal((await store.windows(TREST_REHEARSAL_MINT, "test")).length, 0);
  assert.equal((await store.snapshots(TREST_REHEARSAL_MINT, "test", `test:${TREST_REHEARSAL_MINT}:${START}`)).length, 0);
  assert.equal(rpc.holderReads, 0);
  assert.equal((await store.rehearsalState(TREST_REHEARSAL_MINT, "test"))?.status, "stopped");
  assert.equal((await store.control(TREST_REHEARSAL_MINT, "test"))?.suspended, true);
  assert.equal(rpc.submitsSeen, 0);
  const second = await recoverConfirmedCollection({ ...recoveryInput, store, chain: rpc.chain });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.duplicate, true);
  assert.equal((await store.receipts(TREST_REHEARSAL_MINT, "test")).length, 1);
  assert.equal((await store.collectionRecoveries(TREST_REHEARSAL_MINT, "test")).length, 1);
});

test("a collection instruction that is not the locked account list writes nothing", async () => {
  const store = await stoppedStore();
  const wrong = chain({ identity: { instruction: "CollectCreatorFeeV2", programId: CONFIRMED_COLLECTION.programId, accounts: ["11111111111111111111111111111111"] } });
  const rejected = await recoverConfirmedCollection({ ...recoveryInput, store, chain: wrong.chain });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, "evidence");
  assert.equal((await store.receipts(TREST_REHEARSAL_MINT, "test")).length, 0);
  assert.equal((await store.collectionRecoveries(TREST_REHEARSAL_MINT, "test")).length, 0);
  assert.equal((await store.intents(TREST_REHEARSAL_MINT, "test"))[0]?.status, "uncertain");
});

test("mismatched chain evidence or weak backing does not write and does not fail the intent", async () => {
  const mismatched = await stoppedStore();
  const wrong = chain({ observed: observed({ slot: "1" }) });
  const rejected = await recoverConfirmedCollection({ ...recoveryInput, store: mismatched, chain: wrong.chain });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, "evidence");
  assert.equal((await mismatched.intents(TREST_REHEARSAL_MINT, "test"))[0]?.status, "uncertain");
  assert.equal((await mismatched.receipts(TREST_REHEARSAL_MINT, "test")).length, 0);
  const unbacked = await stoppedStore();
  const poor = chain({ balance: "1" });
  const backing = await recoverConfirmedCollection({ ...recoveryInput, store: unbacked, chain: poor.chain });
  assert.equal(backing.ok, false);
  if (backing.ok) return;
  assert.equal(backing.code, "backing");
  assert.equal((await unbacked.receipts(TREST_REHEARSAL_MINT, "test")).length, 0);
});

test("the net fee split withholds the reserve once and leaves the buyback unspent", () => {
  const planned = plannedCollectionAllocation();
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.withheld, "5000000");
  assert.equal(planned.base, "80140307");
  assert.equal(planned.holders, "24042092");
  assert.equal(planned.buyback, "24042092");
  assert.equal(planned.deployer, "32056123");
  const again = planIncrementalAllocation({
    grossLamports: CONFIRMED_COLLECTION.net,
    reserveLamports: CONFIRMED_COLLECTION.reserve,
    reserveWithheldLamports: planned.withheld,
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.withheld, "0");
  assert.equal(historicalHolderSnapshot().reason, "historical_balances_unavailable");
  assert.equal(buybackRecoveryAuthorisation().ok, false);
  assert.equal(buybackRecoveryAuthorisation().budgetLamports, "24042092");
});

test("a future rehearsal cannot overlap or bypass unresolved financial state", () => {
  const stopped = { generation: 1, status: "stopped" as const, starts: [START, START + WINDOW, START + WINDOW * 2] };
  const later = [START + WINDOW * 3, START + WINDOW * 4, START + WINDOW * 5];
  assert.equal(admitNextRehearsal({
    existing: [stopped],
    generation: 2,
    starts: later,
    unresolvedIntents: 1,
    unallocatedReceipts: 0,
    claimableLiabilities: 0,
  }), "unresolved");
  assert.equal(admitNextRehearsal({
    existing: [stopped],
    generation: 2,
    starts: stopped.starts,
    unresolvedIntents: 0,
    unallocatedReceipts: 0,
    claimableLiabilities: 0,
  }), "overlap");
  assert.equal(admitNextRehearsal({
    existing: [{ ...stopped, status: "open" }],
    generation: 2,
    starts: later,
    unresolvedIntents: 0,
    unallocatedReceipts: 0,
    claimableLiabilities: 0,
  }), "overlap");
  assert.equal(admitNextRehearsal({
    existing: [stopped],
    generation: 2,
    starts: later,
    unresolvedIntents: 0,
    unallocatedReceipts: 1,
    claimableLiabilities: 0,
  }), "unresolved");
  assert.equal(admitNextRehearsal({
    existing: [stopped],
    generation: 2,
    starts: later,
    unresolvedIntents: 0,
    unallocatedReceipts: 0,
    claimableLiabilities: 0,
  }), "ok");
  assert.equal(admitNextRehearsal({
    existing: [stopped],
    generation: 1,
    starts: later,
    unresolvedIntents: 0,
    unallocatedReceipts: 0,
    claimableLiabilities: 0,
  }), "duplicate");
});

test("the recovery command stays operator-only and the worker entrypoints do not import it", async () => {
  const store = await stoppedStore();
  const rpc = chain();
  const command = ["node", "collection-recovery-cli.ts", "--operator", "trest-07j", "--reason", "confirmed collection had no receipt", "--approval", COLLECTION_RECOVERY_APPROVAL];
  const env = {
    TREST_COLLECTION_RECOVERY_AUTHORIZED: "true",
    TREST_DEPLOYER_ADDRESS: CONFIRMED_COLLECTION.deployer,
    REWARDS_LOOP_ENABLED: "false",
    REWARDS_EXECUTION_AUTHORIZED: "false",
    TREST_SIGNER_SUSPENDED: "true",
  };
  const denied = await cliMain(command, { ...env, TREST_COLLECTION_RECOVERY_AUTHORIZED: "false" }, { store, chain: rpc.chain });
  assert.equal(denied.out, "rejected authorisation");
  const live = await cliMain(command, { ...env, REWARDS_LOOP_ENABLED: "true" }, { store, chain: rpc.chain });
  assert.equal(live.out, "rejected suspended");
  const accepted = await cliMain(command, env, { store, chain: rpc.chain });
  assert.deepEqual(accepted, { code: 0, out: "ok" });
  assert.equal(rpc.submitsSeen, 0);
  const server = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const loop = await readFile(new URL("./loop.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("./claim-route.ts", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.equal(server.includes("collection-recovery"), false);
  assert.equal(loop.includes("collection-recovery"), false);
  assert.equal(route.includes("collection-recovery"), false);
  assert.match(manifest, /"start": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types src\/server.ts"/);
  assert.match(manifest, /"recover-collection":/);
});
