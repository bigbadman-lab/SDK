import assert from "node:assert/strict";
import test from "node:test";

import { heliusChain, observeMeta, observeSolClaim, type Chain, type SolClaimExpectation } from "./chain.ts";
import { reconcileStoredSolClaims } from "./run.ts";
import { memoryStore } from "./store.ts";

const SYSTEM = "11111111111111111111111111111111";
const DEPLOYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const HOLDER = "6D1yiRaZjxWKCG7aYVZf9hM2gAwCjb5zYcmHwvyNRtqp";
const OTHER = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const VAULT = "A9iRd6QFkkFYUp5Ee9bDUao4kxz2rvXxMjK18YfiYo3S";
const AMOUNT = 1_490_307;
const FEE = 5_000;

function transfer(input: {
  deployer?: string;
  claimant?: string;
  lamports?: number;
  fee?: number;
  err?: unknown;
  token?: boolean;
  instructions?: unknown[];
}) {
  const deployer = input.deployer ?? DEPLOYER;
  const claimant = input.claimant ?? HOLDER;
  const lamports = input.lamports ?? AMOUNT;
  const fee = input.fee ?? FEE;
  const failed = input.err !== undefined && input.err !== null;
  return {
    meta: {
      err: input.err ?? null,
      fee,
      preBalances: [10_000_000, 1_000, 1],
      postBalances: failed ? [10_000_000, 1_000, 1] : [10_000_000 - lamports - fee, 1_000 + lamports, 1],
      preTokenBalances: input.token ? [{ mint: TREST, owner: deployer }] : [],
      postTokenBalances: input.token ? [{ mint: TREST, owner: claimant }] : [],
    },
    transaction: {
      message: {
        accountKeys: [deployer, claimant, SYSTEM],
        instructions: input.instructions ?? [{
          programId: SYSTEM,
          parsed: { type: "transfer", info: { source: deployer, destination: claimant, lamports } },
        }],
      },
    },
  };
}

test("a confirmed system transfer is a SOL claim without the creator vault", () => {
  const expected: SolClaimExpectation = { deployer: DEPLOYER, claimant: HOLDER, lamports: String(AMOUNT) };
  const observed = observeSolClaim(transfer({}), expected);
  assert.equal(observed.status, "confirmed");
  if (observed.status !== "confirmed") return;
  assert.equal(observed.feeLamports, String(FEE));
  assert.equal(JSON.stringify(transfer({})).includes(VAULT), false);
  const keyed = transfer({});
  keyed.transaction.message.accountKeys = [
    { pubkey: DEPLOYER },
    { pubkey: HOLDER },
    { pubkey: SYSTEM },
  ] as unknown as string[];
  assert.equal(observeSolClaim(keyed, expected).status, "confirmed");
});

test("claim observation rejects the wrong recipient, amount, payer, failure, and unrelated transfer", () => {
  const expected: SolClaimExpectation = { deployer: DEPLOYER, claimant: HOLDER, lamports: String(AMOUNT) };
  assert.equal(observeSolClaim(transfer({ claimant: OTHER }), expected).status, "mismatch");
  assert.equal(observeSolClaim(transfer({ lamports: AMOUNT - 1 }), expected).status, "mismatch");
  assert.equal(observeSolClaim(transfer({ deployer: OTHER }), { ...expected, deployer: DEPLOYER }).status, "mismatch");
  assert.equal(observeSolClaim(transfer({ err: { InstructionError: [0, "Custom"] } }), expected).status, "failed");
  assert.equal(observeSolClaim(null, expected).status, "unconfirmed");
  assert.equal(observeSolClaim({ meta: null }, expected).status, "unconfirmed");
  assert.equal(observeSolClaim(transfer({
    instructions: [
      { programId: SYSTEM, parsed: { type: "transfer", info: { source: DEPLOYER, destination: HOLDER, lamports: 1 } } },
      { programId: SYSTEM, parsed: { type: "transfer", info: { source: DEPLOYER, destination: HOLDER, lamports: AMOUNT } } },
    ],
  }), expected).status, "mismatch");
  assert.equal(observeSolClaim(transfer({ token: true }), expected).status, "mismatch");
  const raw = Buffer.alloc(12);
  raw.writeUInt32LE(2, 0);
  raw.writeBigUInt64LE(BigInt(AMOUNT), 4);
  const encoded = observeSolClaim(transfer({
    instructions: [{ programId: SYSTEM, data: [...raw], accounts: [0, 1] }],
  }), expected);
  assert.equal(encoded.status, "confirmed");
});

test("chain status keeps an unconfirmed or missing signature from becoming a claim", async () => {
  const expected: SolClaimExpectation = { deployer: DEPLOYER, claimant: HOLDER, lamports: String(AMOUNT) };
  const rpc = (status: unknown, tx: unknown) => async (method: string) => {
    if (method === "getSignatureStatuses") return { value: [status] };
    if (method === "getTransaction") return tx;
    throw new Error(`unexpected ${method}`);
  };
  const chainFor = (status: unknown, tx: unknown) => heliusChain(rpc(status, tx));
  assert.equal((await chainFor({ confirmationStatus: "processed", err: null }, transfer({})).solClaim?.("sig", expected))?.status, "unconfirmed");
  assert.equal((await chainFor(null, null).solClaim?.("sig", expected))?.status, "unconfirmed");
  assert.equal((await chainFor({ confirmationStatus: "confirmed", err: { InstructionError: [0, "Custom"] } }, transfer({})).solClaim?.("sig", expected))?.status, "failed");
  assert.equal((await chainFor({ confirmationStatus: "finalized", err: null }, transfer({})).solClaim?.("sig", expected))?.status, "confirmed");
  assert.equal((await chainFor({ confirmationStatus: "confirmed", err: null }, transfer({ claimant: OTHER })).solClaim?.("sig", expected))?.status, "mismatch");
  assert.equal((await chainFor("unreadable", transfer({})).solClaim?.("sig", expected))?.status, "confirmed");
});

test("fee-collection observation still requires the creator vault", () => {
  const collection = observeMeta(
    {
      slot: 9,
      transaction: { message: { accountKeys: [DEPLOYER, VAULT, HOLDER] } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [10_000_000, 1_890_880, 1],
        postBalances: [10_995_000, 890_880, 1],
        preTokenBalances: [],
        postTokenBalances: [],
      },
    },
    { creator: DEPLOYER, solVault: VAULT, wsolVault: HOLDER, parentMint: TREST, destination: DEPLOYER },
  );
  assert.equal(collection?.nativeVaultOut, "1000000");
  assert.equal(observeSolClaim(transfer({}), { deployer: DEPLOYER, claimant: HOLDER, lamports: String(AMOUNT) }).status, "confirmed");
  assert.equal(observeMeta(
    {
      slot: 9,
      transaction: { message: { accountKeys: [DEPLOYER, HOLDER] } },
      meta: { err: null, fee: 5000, preBalances: [10, 1], postBalances: [5, 1], preTokenBalances: [], postTokenBalances: [] },
    },
    { creator: DEPLOYER, solVault: VAULT, wsolVault: HOLDER, parentMint: TREST, destination: HOLDER },
  ), null);
});

test("an expired challenge is unnecessary when reconciling a stored claim signature", async () => {
  const first = Date.UTC(2026, 9, 24, 12, 50, 0);
  const second = first + 300_000;
  const store = memoryStore({
    parent: {
      id: "00000000-0000-4000-8000-000000000001",
      scope: "test",
      symbol: "TREST",
      mintAddress: TREST,
      deployerAddress: DEPLOYER,
      feeRecipientAddress: DEPLOYER,
      feeMode: "single_recipient",
      tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      decimals: 6,
      graduated: false,
      quoteMintAddress: SYSTEM,
      eligible: true,
    },
    control: { suspended: false, reserveLamports: "5000000", cycleCapLamports: "100000000", slippageBps: 100 },
  });
  assert.equal(await store.saveWindow({ parentMint: TREST, scope: "test", windowKey: `test:${TREST}:${first}`, collected: "400", holders: "200", buyback: "0", deployer: "200" }), "ok");
  assert.equal(await store.saveWindow({ parentMint: TREST, scope: "test", windowKey: `test:${TREST}:${second}`, collected: "200", holders: "100", buyback: "0", deployer: "100" }), "ok");
  assert.equal(await store.saveSnapshots(TREST, "test", `test:${TREST}:${first}`, [
    { owner: HOLDER, balance: "16906756542762", solLamports: "80", tokenAmount: "0", cutoffSlot: "1" },
    { owner: OTHER, balance: "50000000000", solLamports: "120", tokenAmount: "0", cutoffSlot: "1" },
  ]), "ok");
  assert.equal(await store.saveSnapshots(TREST, "test", `test:${TREST}:${second}`, [
    { owner: HOLDER, balance: "16906756542762", solLamports: "40", tokenAmount: "0", cutoffSlot: "2" },
  ]), "ok");
  const paid = "claim-sol-holder-paid01";
  const wrong = "claim-sol-holder-wrong1";
  assert.equal(await store.saveClaim({
    claimant: HOLDER, asset: "sol", amount: "80", idempotencyKey: paid, status: "recorded", signature: null, scope: "test", parentMint: TREST, proofHash: "paid",
  }), "ok");
  assert.equal(await store.markClaim(TREST, "test", paid, "uncertain", "stored-signature-paid"), "ok");
  assert.equal(await store.saveClaim({
    claimant: OTHER, asset: "sol", amount: "120", idempotencyKey: wrong, status: "recorded", signature: null, scope: "test", parentMint: TREST, proofHash: "wrong",
  }), "ok");
  assert.equal(await store.markClaim(TREST, "test", wrong, "uncertain", "stored-signature-wrong"), "ok");
  let reads = 0;
  let submits = 0;
  const chain = {
    async solClaim(signature: string, expected: SolClaimExpectation) {
      reads += 1;
      if (signature === "stored-signature-wrong") return { status: "mismatch" as const };
      return observeSolClaim(transfer({ claimant: expected.claimant, lamports: Number(expected.lamports), fee: 1 }), expected);
    },
    async submit() {
      submits += 1;
      return { status: "accepted" as const };
    },
  } as unknown as Chain;
  const firstPass = await reconcileStoredSolClaims({ store, chain, parentMint: TREST, deployer: DEPLOYER });
  assert.equal(firstPass.confirmed, 1);
  assert.equal(submits, 0);
  const claims = await store.claims(TREST, "test");
  assert.equal(claims.length, 2);
  assert.equal(claims.find((claim) => claim.idempotencyKey === paid)?.status, "confirmed");
  assert.equal(claims.find((claim) => claim.idempotencyKey === wrong)?.status, "unreconciled");
  const again = await reconcileStoredSolClaims({ store, chain, parentMint: TREST, deployer: DEPLOYER });
  assert.equal(again.confirmed, 0);
  assert.equal(reads, 3);
  assert.equal((await store.claims(TREST, "test")).length, 2);
  const obligations = await store.solObligations(TREST, "test");
  assert.equal(obligations.holderSol, "300");
  assert.equal(obligations.confirmedHolderSol, "80");
  assert.equal(await store.saveClaim({
    claimant: HOLDER, asset: "sol", amount: "80", idempotencyKey: "claim-sol-holder-again1", status: "recorded", signature: null, scope: "test", parentMint: TREST, proofHash: "again",
  }), "amount");
});

test("a repeated signature cannot confirm a second claim", async () => {
  const start = Date.UTC(2026, 9, 24, 12, 50, 0);
  const store = memoryStore({
    parent: {
      id: "00000000-0000-4000-8000-000000000002",
      scope: "test",
      symbol: "TREST",
      mintAddress: TREST,
      deployerAddress: DEPLOYER,
      feeRecipientAddress: DEPLOYER,
      feeMode: "single_recipient",
      tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      decimals: 6,
      graduated: false,
      quoteMintAddress: SYSTEM,
      eligible: true,
    },
    control: { suspended: false, reserveLamports: "5000000", cycleCapLamports: "100000000", slippageBps: 100 },
  });
  assert.equal(await store.saveWindow({ parentMint: TREST, scope: "test", windowKey: `test:${TREST}:${start}`, collected: "160", holders: "160", buyback: "0", deployer: "0" }), "ok");
  assert.equal(await store.saveSnapshots(TREST, "test", `test:${TREST}:${start}`, [
    { owner: HOLDER, balance: "16906756542762", solLamports: "160", tokenAmount: "0", cutoffSlot: "1" },
  ]), "ok");
  assert.equal(await store.saveClaim({
    claimant: HOLDER, asset: "sol", amount: "80", idempotencyKey: "claim-sol-holder-first1", status: "recorded", signature: null, scope: "test", parentMint: TREST, proofHash: "first",
  }), "ok");
  assert.equal(await store.saveClaim({
    claimant: HOLDER, asset: "sol", amount: "80", idempotencyKey: "claim-sol-holder-copy01", status: "recorded", signature: null, scope: "test", parentMint: TREST, proofHash: "copy",
  }), "ok");
  assert.equal(await store.markClaim(TREST, "test", "claim-sol-holder-first1", "uncertain", "same-signature"), "ok");
  assert.equal(await store.markClaim(TREST, "test", "claim-sol-holder-copy01", "uncertain", "same-signature"), "ok");
  let submits = 0;
  const chain = {
    async solClaim(_signature: string, expected: SolClaimExpectation) {
      return observeSolClaim(transfer({ claimant: expected.claimant, lamports: Number(expected.lamports), fee: 1 }), expected);
    },
    async submit() {
      submits += 1;
      return { status: "accepted" as const };
    },
  } as unknown as Chain;
  const settled = await reconcileStoredSolClaims({ store, chain, parentMint: TREST, deployer: DEPLOYER });
  assert.equal(settled.confirmed, 1);
  assert.equal(submits, 0);
  const claims = await store.claims(TREST, "test");
  assert.equal(claims.filter((claim) => claim.status === "confirmed").length, 1);
  assert.equal(claims.filter((claim) => claim.status === "unreconciled").length, 1);
  assert.equal((await store.solObligations(TREST, "test")).holderSol, "160");
  assert.equal((await store.solObligations(TREST, "test")).confirmedHolderSol, "80");
  const second = await reconcileStoredSolClaims({ store, chain, parentMint: TREST, deployer: DEPLOYER });
  assert.equal(second.confirmed, 0);
  assert.equal((await store.claims(TREST, "test")).length, 2);
});
