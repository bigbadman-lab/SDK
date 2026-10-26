import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { signInspected } from "../../../lib/rewards/signer.ts";
import { serviceChildFees } from "./child-fees.ts";
import {
  resolveTrestParent,
  selectTrestChildren,
  selectTrestClaims,
  selectTrestOpenIntents,
  type TrestParentRow,
} from "./trest-scope.ts";

function address(): string {
  return new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
}

function parent(mint: string, deployer: string, patch: Partial<TrestParentRow> = {}): TrestParentRow {
  return {
    scope: "test",
    symbol: "TREST",
    mintAddress: mint,
    deployerAddress: deployer,
    feeRecipientAddress: deployer,
    feeMode: "single_recipient",
    eligible: true,
    ...patch,
  };
}

function child(mint: string, quoteMint: string, scope: "test" | "production") {
  return {
    mint,
    quoteMint,
    scope,
    category: "official" as const,
    launcher: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
    originator: null,
  };
}

test("TREST child discovery keeps the registered child and drops every other parent", async () => {
  const deployer = address();
  const trestMint = address();
  const otherMint = address();
  const trestChild = address();
  const productionChild = address();
  const wrongChild = address();
  const registered = resolveTrestParent([
    parent(trestMint, deployer),
    { ...parent(address(), address()), scope: "production", symbol: "SDK" },
  ], deployer);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const launches = [
    child(trestChild, trestMint, "test"),
    child(productionChild, address(), "production"),
    child(wrongChild, otherMint, "test"),
  ];
  const selected = selectTrestChildren(registered, launches);
  assert.deepEqual(selected.map((row) => row.mint), [trestChild]);
  const submitted: string[] = [];
  const serviced = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 1, 0),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: selected,
    completedKeys: [],
    readConfig: async () => ({
      adminRevoked: true,
      shareholders: [
        { address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", shareBps: 6000 },
        { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 4000 },
      ],
    }),
    prepare: async () => [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: [255, 203, 19, 79, 244, 68, 8, 159], keys: [] }],
    submit: async (candidate) => {
      submitted.push(candidate.mint);
      return { status: "confirmed", receipts: [{ address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", amount: "1" }] };
    },
  });
  assert.equal(serviced.ok, true);
  if (!serviced.ok) return;
  assert.equal(serviced.submitted, 1);
  assert.deepEqual(submitted, [trestChild]);
  const open = selectTrestOpenIntents(registered, selected, [
    { scope: "test", quoteMint: trestMint, childMint: trestChild, idempotencyKey: "trest-open" },
    { scope: "production", quoteMint: trestMint, childMint: productionChild, idempotencyKey: "production-open" },
    { scope: "test", quoteMint: otherMint, childMint: wrongChild, idempotencyKey: "wrong-mint" },
    { scope: "test", quoteMint: trestMint, childMint: address(), idempotencyKey: "undiscovered" },
  ]);
  assert.deepEqual(open.map((row) => row.idempotencyKey), ["trest-open"]);
  const claims = selectTrestClaims(registered, [
    { scope: "test", parentMint: trestMint, nonce: "trest-claim" },
    { scope: "production", parentMint: address(), nonce: "production-claim" },
    { scope: "test", parentMint: otherMint, nonce: "wrong-claim" },
  ]);
  assert.deepEqual(claims.map((row) => row.nonce), ["trest-claim"]);
});

test("a missing, ineligible, mismatched, or ambiguous TREST registration blocks child and claim execution", () => {
  const deployer = address();
  const mint = address();
  const launches = [child(address(), mint, "test")];
  const claims = [{ scope: "test", parentMint: mint }];
  const blocked = [
    resolveTrestParent([], deployer),
    resolveTrestParent([parent(mint, deployer, { eligible: false })], deployer),
    resolveTrestParent([parent(mint, deployer, { feeMode: "fee_sharing" })], deployer),
    resolveTrestParent([parent(mint, deployer, { deployerAddress: address() })], deployer),
    resolveTrestParent([parent(mint, deployer, { feeRecipientAddress: address() })], deployer),
    resolveTrestParent([parent(mint, address(), { scope: "production", symbol: "SDK" })], deployer),
    resolveTrestParent([parent(mint, deployer), parent(address(), deployer)], deployer),
    resolveTrestParent([parent(mint, deployer)], address()),
  ];
  for (const decision of blocked) {
    assert.equal(decision.ok, false);
    assert.deepEqual(selectTrestChildren(decision, launches), []);
    assert.deepEqual(selectTrestOpenIntents(decision, launches, [{ scope: "test", quoteMint: mint, childMint: launches[0]?.mint ?? "" }]), []);
    assert.deepEqual(selectTrestClaims(decision, claims), []);
  }
  const verified = resolveTrestParent([parent(mint, deployer)], deployer);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(selectTrestClaims(verified, claims).length, 1);
});

test("a suspended signer produces no signature", () => {
  const pair = nacl.sign.keyPair();
  const secret = bs58.encode(pair.secretKey);
  const expected = new PublicKey(pair.publicKey).toBase58();
  const signed = signInspected({
    secret,
    expectedAddress: expected,
    suspended: true,
    transaction: { feePayer: expected, recentBlockhash: "11111111111111111111111111111111", instructions: [] },
    policy: {
      kind: "claim_sol",
      scope: "production",
      parentMint: expected,
      deployer: expected,
      recipient: expected,
      maxLamports: "1",
      maxRentLamports: "0",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    },
  });
  assert.equal(signed.ok, false);
  if (signed.ok) return;
  assert.equal(signed.code, "suspended");
});

test("worker queries and the claim executor are bound to the registered TREST parent", () => {
  const loop = readFileSync(new URL("./loop.ts", import.meta.url), "utf8");
  const executor = readFileSync(new URL("./claim-execute.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("./claim-route.ts", import.meta.url), "utf8");
  assert.equal(loop.includes("parent_scope in"), false);
  assert.equal(loop.includes("parent_scope = 'test'"), true);
  assert.equal(loop.includes("scope = 'test'"), true);
  assert.equal(loop.includes("loadVerifiedTrestParent"), true);
  assert.equal(loop.includes("selectTrestChildren"), true);
  assert.equal(loop.includes("selectTrestOpenIntents"), true);
  assert.equal(loop.includes("selectTrestClaims"), true);
  const trestGate = executor.indexOf("if (!trestClaimAllowed");
  assert.ok(trestGate > 0);
  assert.ok(executor.indexOf("await submitClaim", trestGate) > trestGate);
  assert.equal(route.includes("parsed.claim.scope !== \"test\""), true);
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.equal(server.includes("startRewardsLoop"), false);
  assert.equal(server.includes('mode: "production"'), true);
});
