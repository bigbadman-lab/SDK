import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "./fees.ts";
import { preflightChildLaunch } from "./preflight.ts";
import { noteBroadcast, noteChain } from "./submission.ts";
import type { SubmissionIntent } from "./submission.ts";
import { planRecovery, planSubmission, type StoredLaunchBuild } from "./submit-plan.ts";
import { finishLaunchSignatures } from "./v1-signature.ts";

function flip(bytes: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ 255;
  return copy;
}

const BLOCKHASH = "11111111111111111111111111111111";
const LAUNCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARENT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";

async function signedWire(data = Uint8Array.of(1, 2, 3)) {
  const wallet = await generateKeyPair();
  const mint = await generateKeyPair();
  const walletAddress = await getAddressFromPublicKey(wallet.publicKey);
  const mintAddress = await getAddressFromPublicKey(mint.publicKey);
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (current) => setTransactionMessageFeePayer(walletAddress, current),
    (current) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH as never, lastValidBlockHeight: BigInt(100) },
        current,
      ),
    (current) =>
      appendTransactionMessageInstruction(
        {
          programAddress: address("11111111111111111111111111111111"),
          accounts: [
            { address: walletAddress, role: AccountRole.WRITABLE_SIGNER },
            { address: mintAddress, role: AccountRole.WRITABLE_SIGNER },
          ],
          data,
        },
        current,
      ),
  );
  const compiled = compileTransaction(message);
  const copy = new ArrayBuffer(compiled.messageBytes.byteLength);
  new Uint8Array(copy).set(Uint8Array.from(compiled.messageBytes));
  const hash = await crypto.subtle.digest("SHA-256", copy);
  const messageHash = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const walletSigned = Uint8Array.from(getTransactionEncoder().encode(await partiallySignTransaction([wallet], compiled)));
  const committed = Uint8Array.from(getTransactionEncoder().encode(compiled));
  const finished = await finishLaunchSignatures({
    committedTransaction: committed,
    walletSignedTransaction: walletSigned,
    mint,
    walletAddress,
    mintAddress,
    messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
  });
  assert.equal(finished.ok, true);
  if (!finished.ok) throw new Error("sign");
  return { transaction: finished.transaction, walletAddress, mintAddress, messageHash };
}

function build(wire: Awaited<ReturnType<typeof signedWire>>, patch: Partial<StoredLaunchBuild> = {}): StoredLaunchBuild {
  const fees = allocateCreatorFees({
    category: "originator_launch",
    launcherWallet: wire.walletAddress,
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  if (!fees.ok) throw new Error(fees.code);
  return {
    launchId: LAUNCH,
    buildId: BUILD,
    accountId: ACCOUNT,
    wallet: wire.walletAddress,
    childMint: wire.mintAddress,
    parentMint: PARENT,
    scope: "test",
    messageHash: wire.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    metadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    shareholders: fees.shareholders,
    category: "originator_launch",
    originatorWallet: null,
    productionParentRegistered: false,
    status: "built",
    ...patch,
  };
}

test("a signed build is held until that launch is approved", async () => {
  const wire = await signedWire();
  const stored = build(wire);
  const held = await planSubmission({
    accountId: ACCOUNT,
    build: stored,
    transaction: wire.transaction,
    now: 1_000,
    existing: null,
    approval: null,
    wireKeyPresent: true,
  });
  assert.equal(held.ok, true);
  if (!held.ok) return;
  assert.equal(held.broadcast, "hold");
  assert.equal(held.intent.status, "submission_pending");
  assert.equal(held.intent.parentMint, PARENT);
  assert.equal(held.intent.signature.length >= 64, true);
  assert.equal(
    held.intent.signature,
    getSignatureFromTransaction(getTransactionDecoder().decode(wire.transaction)),
  );
  const approved = await planSubmission({
    accountId: ACCOUNT,
    build: stored,
    transaction: wire.transaction,
    now: 1_000,
    existing: held.intent,
    approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" },
    wireKeyPresent: true,
  });
  assert.equal(approved.ok && approved.broadcast, "send");
});

test("submission rejects a bad signature, a changed message, the wrong parent, fees, buy, and expiry", async () => {
  const wire = await signedWire();
  const stored = build(wire);
  const walletBroken = flip(wire.transaction, 1);
  const badWallet = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: walletBroken, now: 1_000, existing: null, approval: null, wireKeyPresent: true,
  });
  assert.equal(badWallet.ok, false);
  const mintBroken = flip(wire.transaction, 65);
  const badMint = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: mintBroken, now: 1_000, existing: null, approval: null, wireKeyPresent: true,
  });
  assert.equal(badMint.ok, false);
  const changed = flip(wire.transaction, wire.transaction.length - 1);
  const modified = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: changed, now: 1_000, existing: null, approval: null, wireKeyPresent: true,
  });
  assert.equal(modified.ok, false);
  const wrongParent = await planSubmission({
    accountId: ACCOUNT,
    build: build(wire, { parentMint: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1" }),
    transaction: wire.transaction,
    now: 1_000,
    existing: null,
    approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" },
    wireKeyPresent: true,
  });
  assert.equal(wrongParent.ok, true);
  if (wrongParent.ok) assert.equal(wrongParent.broadcast, "hold");
  const wrongFees = await planSubmission({
    accountId: ACCOUNT,
    build: build(wire, { shareholders: stored.shareholders.map((row) => ({ ...row, shareBps: row.shareBps === 8500 ? 8400 : row.shareBps })) }),
    transaction: wire.transaction,
    now: 1_000,
    existing: null,
    approval: null,
    wireKeyPresent: true,
  });
  assert.equal(wrongFees.ok, false);
  if (!wrongFees.ok) assert.equal(wrongFees.code, "fees");
  const wrongBuy = await planSubmission({
    accountId: ACCOUNT,
    build: build(wire, { buyAmount: "1", messageHash: "ab".repeat(32) }),
    transaction: wire.transaction,
    now: 1_000,
    existing: null,
    approval: null,
    wireKeyPresent: true,
  });
  assert.equal(wrongBuy.ok, false);
  const expired = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 3_000, existing: null, approval: null, wireKeyPresent: true,
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.code, "expired");
});

test("unauthorised, duplicate, and concurrent submissions stay on one signature", async () => {
  const wire = await signedWire();
  const stored = build(wire);
  const foreign = await planSubmission({
    accountId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    build: stored,
    transaction: wire.transaction,
    now: 1_000,
    existing: null,
    approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" },
    wireKeyPresent: true,
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, "forbidden");
  const first = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 1_000, existing: null, approval: null, wireKeyPresent: true,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const duplicate = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 1_000, existing: { ...first.intent, status: "submitted" }, approval: null, wireKeyPresent: true,
  });
  assert.equal(duplicate.ok && duplicate.broadcast, "hold");
  const other = await signedWire(Uint8Array.of(9, 9, 9));
  const conflict = await planSubmission({
    accountId: ACCOUNT,
    build: build(other),
    transaction: other.transaction,
    now: 1_000,
    existing: first.intent,
    approval: null,
    wireKeyPresent: true,
  });
  assert.equal(conflict.ok, false);
  const state: { current: SubmissionIntent | null } = { current: null };
  let chain: Promise<void> = Promise.resolve();
  const lock = async <T>(run: () => Promise<T>): Promise<T> => {
    const previous = chain;
    let release = () => {};
    chain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  };
  const once = () =>
    lock(async () => {
      const plan = await planSubmission({
        accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 1_000, existing: state.current, approval: null, wireKeyPresent: true,
      });
      if (plan.ok) state.current = plan.intent;
      return plan;
    });
  const [left, right] = await Promise.all([once(), once()]);
  assert.equal(left.ok && right.ok, true);
  assert.equal(state.current?.signature, first.intent.signature);
});

test("a missing wire key does not broadcast, and recovery separates failure from an unknown outcome", async () => {
  const wire = await signedWire();
  const stored = build(wire);
  const missingKey = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 1_000, existing: null, approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" }, wireKeyPresent: false,
  });
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.equal(missingKey.code, "wire_key");
  const pending = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 1_000, existing: null, approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" }, wireKeyPresent: true,
  });
  assert.equal(pending.ok && pending.broadcast, "send");
  if (!pending.ok) return;
  const crashed = await planSubmission({
    accountId: ACCOUNT, build: stored, transaction: wire.transaction, now: 1_000, existing: pending.intent, approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" }, wireKeyPresent: true,
  });
  assert.equal(crashed.ok && crashed.broadcast, "send");
  const timedOut = noteBroadcast(pending.intent, "timeout");
  assert.equal(timedOut.status, "uncertain");
  const unknown = noteBroadcast(pending.intent, "unknown");
  assert.equal(unknown.status, "uncertain");
  const failed = planRecovery({ existing: pending.intent, observed: "failed", blockhashExpired: false, approvalMatches: true, wireRetained: true });
  assert.equal(failed.ok && failed.intent.status, "failed");
  if (failed.ok) assert.equal(failed.action, "hold");
  const recovered = planRecovery({ existing: unknown, observed: "missing", blockhashExpired: false, approvalMatches: true, wireRetained: true });
  assert.equal(recovered.ok && recovered.action, "hold");
  if (recovered.ok) assert.equal(recovered.intent.status, "uncertain");
  if (recovered.ok) assert.equal(recovered.intent.signature, pending.intent.signature);
  const chainFailed = noteChain(pending.intent, "failed", false);
  assert.equal(chainFailed.status, "failed");
  const production = await planSubmission({
    accountId: ACCOUNT,
    build: build(wire, { scope: "production", productionParentRegistered: false }),
    transaction: wire.transaction,
    now: 1_000,
    existing: null,
    approval: { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "production" },
    wireKeyPresent: true,
  });
  assert.equal(production.ok, false);
  if (!production.ok) assert.equal(production.code, "parent_unregistered");
});

test("public rehearsal selection stays on the operator and simulation waits for TREST", async () => {
  const page = readFileSync(new URL("../../app/launch/page.tsx", import.meta.url), "utf8");
  const prepare = readFileSync(new URL("../../app/api/launch/prepare/route.ts", import.meta.url), "utf8");
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("isProvisionedOperator"), true);
  assert.equal(prepare.includes("isProvisionedOperator"), true);
  assert.equal(form.includes("sendTransaction"), false);
  assert.equal(form.includes("disabled"), true);
  let calls = 0;
  const blocked = await preflightChildLaunch({
    registeredParent: null,
    transaction: "signed",
    simulate: async () => {
      calls += 1;
      return true;
    },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, "parent_unregistered");
  assert.equal(calls, 0);
});
