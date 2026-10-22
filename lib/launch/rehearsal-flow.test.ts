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
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { verifyLaunchEvidence } from "./chain-evidence.ts";
import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "./fees.ts";
import { preflightChildLaunch, preflightMessageBound } from "./preflight.ts";
import { launchMessage } from "./messages.ts";
import { recoveryPhase, rehearsalSignAllowed } from "./rehearsal-flow.ts";
import { noteBroadcast, noteChain, noteVerification } from "./submission.ts";
import { planRecovery, planSubmission, type StoredLaunchBuild } from "./submit-plan.ts";
import { finishLaunchSignatures, messageHashOf } from "./v1-signature.ts";
import { requestPhantomSignature, type PhantomSignInput } from "../wallet/phantom-sign.ts";

const BLOCKHASH = "11111111111111111111111111111111";
const LAUNCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARENT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

test("the public path stays closed and a non-operator cannot open a TREST rehearsal", () => {
  const page = readFileSync(new URL("../../app/launch/page.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  const build = readFileSync(new URL("../../app/api/launch/build/route.ts", import.meta.url), "utf8");
  assert.equal(page.includes("isProvisionedOperator"), true);
  assert.equal(form.includes('phase="unavailable"'), true);
  assert.equal(form.includes("disabled"), true);
  assert.equal(form.includes("sendTransaction"), false);
  assert.equal(form.includes("/api/launch/build"), false);
  assert.equal(form.includes("RehearsalActions"), true);
  assert.equal(build.includes('request.headers.get("x-sdk-rehearsal") === "trest"'), true);
  const closed = rehearsalSignAllowed({
    operator: false,
    parentRegistered: true,
    persistenceReady: true,
    committedHash: "a".repeat(64),
    preflightHash: "a".repeat(64),
    buildId: BUILD,
    approvedBuildId: BUILD,
    mintAvailable: true,
  });
  assert.equal(closed.allowed, false);
  assert.equal(closed.reason, "public");
  const actions = readFileSync(new URL("../../components/launch/rehearsal-actions.tsx", import.meta.url), "utf8");
  assert.equal(actions.includes('setPhase("unavailable")'), false);
  assert.equal(actions.includes("audiencePair(true)"), true);
  const sign = actions.slice(actions.indexOf("async function signAndSubmit"));
  const requestAt = sign.indexOf("requestPhantomSignature");
  assert.ok(requestAt > 0);
  assert.equal(sign.slice(0, requestAt).includes("await "), false);
  assert.equal(launchMessage("simulation_failed").includes("did not simulate"), true);
  assert.equal(launchMessage("simulation_failed").includes("not accepted"), false);
  assert.equal(launchMessage("builder_rejected").includes("not accepted"), false);
});

test("signing stays closed until the parent, preflight, approval, and mint all match", () => {
  const ready = {
    operator: true,
    parentRegistered: true,
    persistenceReady: true,
    committedHash: "ab".repeat(32),
    preflightHash: "ab".repeat(32),
    buildId: BUILD,
    approvedBuildId: BUILD,
    mintAvailable: true,
  };
  assert.equal(rehearsalSignAllowed(ready).reason, "ready");
  assert.equal(rehearsalSignAllowed({ ...ready, parentRegistered: false }).reason, "parent_unregistered");
  assert.equal(rehearsalSignAllowed({ ...ready, persistenceReady: false }).reason, "not_ready");
  assert.equal(rehearsalSignAllowed({ ...ready, preflightHash: "cd".repeat(32) }).reason, "preflight");
  assert.equal(rehearsalSignAllowed({ ...ready, approvedBuildId: null }).reason, "approval");
  assert.equal(rehearsalSignAllowed({ ...ready, approvedBuildId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }).reason, "approval");
  assert.equal(rehearsalSignAllowed({ ...ready, mintAvailable: false }).reason, "mint_lost");
  assert.equal(preflightMessageBound(ready.committedHash, "cd".repeat(32)).ok, false);
  assert.equal(preflightMessageBound(ready.committedHash, ready.committedHash).ok, true);
});

test("an unregistered TREST parent does not simulate, and a changed message invalidates preflight", async () => {
  let calls = 0;
  const missing = await preflightChildLaunch({
    registeredParent: null,
    transaction: "wire",
    simulate: async () => {
      calls += 1;
      return true;
    },
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "parent_unregistered");
  assert.equal(calls, 0);
  const simulate = readFileSync(new URL("../../app/api/admin/trest/simulate/route.ts", import.meta.url), "utf8");
  const wire = readFileSync(new URL("../../lib/server/launch/simulate-wire.ts", import.meta.url), "utf8");
  assert.equal(simulate.includes("transaction: null"), false);
  assert.equal(wire.includes("replaceRecentBlockhash: false"), true);
  assert.equal(wire.includes("sigVerify: false"), true);
});

test("Phantom signs the exact v1 bytes, then the mint co-signs the unchanged message", async () => {
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
          data: Uint8Array.of(1, 2, 3),
        },
        current,
      ),
  );
  const compiled = compileTransaction(message);
  const committed = Uint8Array.from(getTransactionEncoder().encode(compiled));
  const messageHash = await messageHashOf(committed);
  assert.equal(typeof messageHash, "string");
  const rejected = await requestPhantomSignature({
    sessionAddress: walletAddress,
    connectedAddress: walletAddress,
    wallets: [
      {
        name: "Phantom",
        accounts: [{ address: walletAddress }],
        signTransactionVersions: ["legacy", 0, 1],
        signTransaction: async () => {
          throw new Error("declined");
        },
      } satisfies PhantomSignInput,
    ],
    transaction: committed,
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "sign_rejected");
  const walletSigned = Uint8Array.from(getTransactionEncoder().encode(await partiallySignTransaction([wallet], compiled)));
  const signed = await requestPhantomSignature({
    sessionAddress: walletAddress,
    connectedAddress: walletAddress,
    wallets: [
      {
        name: "Phantom",
        accounts: [{ address: walletAddress }],
        signTransactionVersions: ["legacy", 0, 1],
        signTransaction: async (bytes) => {
          assert.deepEqual(bytes, committed);
          return walletSigned;
        },
      },
    ],
    transaction: committed,
  });
  assert.equal(signed.ok, true);
  if (!signed.ok || !messageHash) return;
  const other = pipe(
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
          data: Uint8Array.of(9, 9, 9),
        },
        current,
      ),
  );
  const altered = Uint8Array.from(
    getTransactionEncoder().encode(await partiallySignTransaction([wallet], compileTransaction(other))),
  );
  const changed = await finishLaunchSignatures({
    committedTransaction: committed,
    walletSignedTransaction: altered,
    mint,
    walletAddress,
    mintAddress,
    messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.code, "message_changed");
  const finished = await finishLaunchSignatures({
    committedTransaction: committed,
    walletSignedTransaction: signed.signedTransaction,
    mint,
    walletAddress,
    mintAddress,
    messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
  });
  assert.equal(finished.ok, true);
  if (!finished.ok) return;
  assert.deepEqual(finished.transaction.subarray(0, committed.length > 0 ? 1 : 0), committed.subarray(0, 1));
  const observed = await messageHashOf(finished.transaction);
  assert.equal(observed, messageHash);

  const fees = allocateCreatorFees({
    category: "originator_launch",
    launcherWallet: walletAddress,
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  assert.equal(fees.ok, true);
  if (!fees.ok) return;
  const stored: StoredLaunchBuild = {
    launchId: LAUNCH,
    buildId: BUILD,
    accountId: ACCOUNT,
    wallet: walletAddress,
    childMint: mintAddress,
    parentMint: PARENT,
    scope: "test",
    messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    metadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    shareholders: fees.shareholders,
    category: "originator_launch",
    originatorWallet: null,
    productionParentRegistered: false,
    status: "built",
  };
  const approval = { launchId: LAUNCH, buildId: BUILD, parentMint: PARENT, scope: "test" as const };
  const missingKey = await planSubmission({
    accountId: ACCOUNT,
    build: stored,
    transaction: finished.transaction,
    now: 1_000,
    existing: null,
    approval,
    wireKeyPresent: false,
  });
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.equal(missingKey.code, "wire_key");
  const wrongBuild = await planSubmission({
    accountId: ACCOUNT,
    build: stored,
    transaction: finished.transaction,
    now: 1_000,
    existing: null,
    approval: { ...approval, buildId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    wireKeyPresent: true,
  });
  assert.equal(wrongBuild.ok && wrongBuild.broadcast, "hold");
  const sent = await planSubmission({
    accountId: ACCOUNT,
    build: stored,
    transaction: finished.transaction,
    now: 1_000,
    existing: null,
    approval,
    wireKeyPresent: true,
  });
  assert.equal(sent.ok && sent.broadcast, "send");
  if (!sent.ok) return;
  const state: { current: typeof sent.intent | null } = { current: sent.intent };
  const lock = { held: false, wait: [] as (() => void)[] };
  const once = () =>
    new Promise<Awaited<ReturnType<typeof planSubmission>>>((resolve) => {
      const run = async () => {
        const plan = await planSubmission({
          accountId: ACCOUNT,
          build: stored,
          transaction: finished.transaction,
          now: 1_000,
          existing: state.current,
          approval,
          wireKeyPresent: true,
        });
        if (plan.ok) state.current = plan.intent;
        resolve(plan);
        lock.held = false;
        lock.wait.shift()?.();
      };
      if (lock.held) lock.wait.push(() => void run());
      else {
        lock.held = true;
        void run();
      }
    });
  const [left, right] = await Promise.all([once(), once()]);
  assert.equal(left.ok && right.ok, true);
  if (left.ok && right.ok) assert.equal(left.intent.signature, right.intent.signature);
  const unknown = noteBroadcast(sent.intent, "unknown");
  assert.equal(unknown.status, "uncertain");
  assert.equal(unknown.signature, sent.intent.signature);
  const restarted = planRecovery({
    existing: unknown,
    observed: "missing",
    blockhashExpired: false,
    approvalMatches: true,
    wireRetained: true,
  });
  assert.equal(restarted.ok && restarted.action, "rebroadcast");
  if (restarted.ok) assert.equal(restarted.intent.signature, sent.intent.signature);
  const confirmed = noteChain(sent.intent, "confirmed", false);
  const commitment = {
    childMint: mintAddress,
    parentMint: PARENT,
    launcher: walletAddress,
    tokenProgram: TOKEN_2022,
    metadataUri: stored.metadataUri,
    buyAmount: "0",
    shareholders: fees.shareholders,
  };
  const broken = verifyLaunchEvidence(commitment, {
    transactionStatus: "confirmed",
    transactionError: false,
    slot: "1",
    mintExists: true,
    tokenProgram: TOKEN_2022,
    quoteMint: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
    launcher: walletAddress,
    metadataUri: stored.metadataUri,
    shareholders: fees.shareholders,
    adminRevoked: true,
    buyExecuted: false,
  });
  assert.equal(noteVerification(confirmed, broken).status, "failed");
  const matched = verifyLaunchEvidence(commitment, {
    transactionStatus: "confirmed",
    transactionError: false,
    slot: "9",
    mintExists: true,
    tokenProgram: TOKEN_2022,
    quoteMint: PARENT,
    launcher: walletAddress,
    metadataUri: stored.metadataUri,
    shareholders: fees.shareholders,
    adminRevoked: true,
    buyExecuted: false,
  });
  const verified = noteVerification(confirmed, matched);
  assert.equal(verified.status, "verified");
  assert.equal(recoveryPhase(verified.status).verified, true);
  assert.equal(recoveryPhase(unknown.status).verified, false);
  assert.equal(recoveryPhase("submitted").phase, "awaiting_confirmation");
});
