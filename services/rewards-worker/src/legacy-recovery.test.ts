import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import type { Chain, ObservedTransaction } from "./chain.ts";
import { reconcileLegacyCollection } from "./legacy-recovery.ts";
import { memoryStore, type RegisteredParent } from "./store.ts";

const MINT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const FIRST = {
  idempotencyKey: "collect-1792587300000",
  signature: "3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m",
};
const SECOND = {
  idempotencyKey: "collect-1792587600000",
  signature: "Rh18WpUe1wkT8bV8eVev7uTg1SY4jf1tRqdjo6c6Zufmtqbs5n99Yq6kJ3HzLLnxXKdtcKuwjKhWPpQx5E3Cqu6",
};
const CREATED_AT_MS = String((1_000_000 + 1000) * 1000);
const SYSTEM = "11111111111111111111111111111111";

function address(): string {
  return new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
}

function chain(patch: Partial<Chain> = {}): Chain {
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
      throw new Error("legacy recovery must not broadcast");
    },
    async signatureState() {
      return "absent";
    },
    async transaction() {
      return null;
    },
  };
  return { ...base, ...patch };
}

function fixture() {
  const deployer = address();
  const parent: RegisteredParent = {
    id: "00000000-0000-4000-8000-000000000001",
    scope: "test",
    symbol: "TREST",
    mintAddress: MINT,
    deployerAddress: deployer,
    feeRecipientAddress: deployer,
    feeMode: "single_recipient",
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 6,
    graduated: false,
    quoteMintAddress: SYSTEM,
    eligible: true,
  };
  const store = memoryStore({
    parent,
    control: { suspended: true, reserveLamports: "5000000", cycleCapLamports: "100000000", slippageBps: 100 },
  });
  return { deployer, store };
}

async function seed(store: ReturnType<typeof fixture>["store"], row: { idempotencyKey: string; signature: string }, patch?: { createdAtMs?: string; blockhash?: string | null }) {
  assert.equal(await store.recordIntent({
    idempotencyKey: row.idempotencyKey,
    parentMint: MINT,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: patch?.blockhash ?? null,
    createdAtMs: patch?.createdAtMs ?? CREATED_AT_MS,
  }), "ok");
  assert.equal(await store.markIntent(MINT, "test", row.idempotencyKey, "submitted", row.signature), "ok");
  assert.equal(await store.markIntent(MINT, "test", row.idempotencyKey, "uncertain", row.signature), "ok");
}

function request(store: ReturnType<typeof fixture>["store"], deployer: string, row: { idempotencyKey: string; signature: string }, patch: Partial<Parameters<typeof reconcileLegacyCollection>[0]> = {}) {
  return reconcileLegacyCollection({
    authorised: true,
    parentMint: MINT,
    scope: "test",
    idempotencyKey: row.idempotencyKey,
    signature: row.signature,
    approval: "TREST-07F-LEGACY-RECOVERY",
    operator: "operator-1",
    reason: "The signed blockhash window has elapsed and the signature is absent.",
    deployer,
    store,
    chain: chain(),
    ...patch,
  });
}

test("an exact legacy intent records immutable evidence and stays uncertain", async () => {
  const env = fixture();
  await seed(env.store, FIRST);
  const result = await request(env.store, env.deployer, FIRST);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.signatureState, "absent");
  assert.equal(result.evidence.transaction, "absent");
  assert.equal(result.evidence.blockhashSlots, "150");
  assert.equal(Number(result.evidence.slotsElapsed) >= 150, true);
  const stored = (await env.store.intents(MINT, "test")).find((intent) => intent.idempotencyKey === FIRST.idempotencyKey);
  assert.equal(stored?.status, "uncertain");
  assert.equal(stored?.signature, FIRST.signature);
  assert.equal(stored?.recentBlockhash, null);
  const audit = await env.store.legacyRecoveries(MINT, "test");
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.approval, "TREST-07F-LEGACY-RECOVERY");
  assert.equal(audit[0]?.priorStatus, "uncertain");
  assert.equal(audit[0]?.evidence.currentSlot, "5000");
  const duplicate = await request(env.store, env.deployer, FIRST);
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.code, "duplicate");
  assert.equal((await env.store.legacyRecoveries(MINT, "test")).length, 1);
});

test("legacy recovery rejects the wrong parent, signature, approval, and incomplete evidence", async () => {
  const env = fixture();
  await seed(env.store, FIRST);
  await seed(env.store, SECOND);
  const wrongMint = await request(env.store, env.deployer, FIRST, { parentMint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse" });
  const wrongScope = await request(env.store, env.deployer, FIRST, { scope: "production" });
  const wrongSignature = await request(env.store, env.deployer, FIRST, { signature: SECOND.signature });
  const wrongKey = await request(env.store, env.deployer, { idempotencyKey: "collect-not-legacy-0001", signature: FIRST.signature });
  const missingApproval = await request(env.store, env.deployer, FIRST, { authorised: false });
  const badPhrase = await request(env.store, env.deployer, FIRST, { approval: "approve" });
  const absentOnly = await request(env.store, env.deployer, FIRST, { chain: chain({ async slot() { return "1100"; } }) });
  const unknownStatus = await request(env.store, env.deployer, FIRST, { chain: chain({ async signatureState() { return "unknown"; } }) });
  assert.equal(wrongMint.ok, false);
  assert.equal(wrongScope.ok, false);
  assert.equal(wrongSignature.ok, false);
  assert.equal(wrongKey.ok, false);
  assert.equal(missingApproval.ok, false);
  assert.equal(badPhrase.ok, false);
  assert.equal(absentOnly.ok, false);
  assert.equal(unknownStatus.ok, false);
  if (wrongMint.ok || wrongScope.ok || wrongSignature.ok || wrongKey.ok || missingApproval.ok || badPhrase.ok || absentOnly.ok || unknownStatus.ok) return;
  assert.equal(wrongMint.code, "parent");
  assert.equal(wrongScope.code, "parent");
  assert.equal(wrongSignature.code, "signature");
  assert.equal(wrongKey.code, "intent");
  assert.equal(missingApproval.code, "approval");
  assert.equal(badPhrase.code, "approval");
  assert.equal(absentOnly.code, "evidence");
  assert.equal(unknownStatus.code, "evidence");
  assert.equal((await env.store.legacyRecoveries(MINT, "test")).length, 0);
});

test("a confirmed collection or a stored blockhash cannot use legacy recovery", async () => {
  const confirmed = fixture();
  await seed(confirmed.store, FIRST);
  assert.equal(await confirmed.store.markIntent(MINT, "test", FIRST.idempotencyKey, "confirmed", FIRST.signature), "ok");
  const confirmedResult = await request(confirmed.store, confirmed.deployer, FIRST);
  assert.equal(confirmedResult.ok, false);
  if (confirmedResult.ok) return;
  assert.equal(confirmedResult.code, "confirmed");

  const receipt = fixture();
  await seed(receipt.store, SECOND);
  assert.equal(await receipt.store.saveReceipt({
    signature: SECOND.signature,
    parentMint: MINT,
    scope: "test",
    amountLamports: "1",
    slot: "44",
    confirmed: true,
    source: "creator_vault",
    gross: "1",
    fee: "0",
    native: "1",
    wsolConverted: "0",
    rentExcluded: "0",
  }), "ok");
  const receiptResult = await request(receipt.store, receipt.deployer, SECOND);
  assert.equal(receiptResult.ok, false);
  if (receiptResult.ok) return;
  assert.equal(receiptResult.code, "confirmed");

  const live = fixture();
  await seed(live.store, FIRST, { blockhash: "2".repeat(43) });
  const liveResult = await request(live.store, live.deployer, FIRST);
  assert.equal(liveResult.ok, false);
  if (liveResult.ok) return;
  assert.equal(liveResult.code, "legacy");
  const landedStore = fixture();
  await seed(landedStore.store, SECOND);
  const observed: ObservedTransaction = {
    status: "confirmed",
    slot: "44",
    feeLamports: "5000",
    feePayer: live.deployer,
    nativeVaultOut: "1",
    creatorDelta: "1",
    wsolTokenOut: "0",
    wsolClosedLamports: "0",
    wsolRentLamports: "0",
    tokenDelta: "0",
    destinationDelta: "1",
    destinationTokenDelta: "0",
  };
  const landed = await request(landedStore.store, landedStore.deployer, SECOND, {
    chain: chain({ async transaction() { return observed; } }),
  });
  assert.equal(landed.ok, false);
  if (landed.ok) return;
  assert.equal(landed.code, "confirmed");
});
