import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { buildSolClaim, buildTokenClaim, TOKEN_2022_PROGRAM_ID } from "./claim.ts";
import {
  acquireCycleLock,
  allocateWindow,
  buybackBlocked,
  markSubmitted,
  observeIntent,
  recordIntent,
  releaseCycleLock,
  windowKey,
} from "./cycle.ts";
import { WINDOW_MS, authoriseBucketSpend, buybackSpendAllowed, planIncrementalAllocation, quoteInsideBuybackBudget, reservedBuybackSpendAllowed } from "./ledger.ts";
import { PUMP_PROGRAM_ID } from "./collect.ts";
import { snapshotHolders } from "./holders.ts";
import { reconcileBuyback, reconcileCreatorFee } from "./reconcile.ts";
import { rewardsExecutionEnabled, signInspected } from "./signer.ts";

const TREST = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const DEPLOYER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const HOLDER = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const CURVE = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";

test("a confirmed creator-vault receipt is credited without counting deposits", () => {
  const credited = reconcileCreatorFee({
    status: "confirmed",
    signature: "5".repeat(64),
    slot: "20",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: DEPLOYER,
    vaultOutLamports: "1000000",
    networkFeeLamports: "5000",
    unrelatedDepositLamports: "9000000",
    creatorDeltaLamports: "9995000",
    existing: [],
  });
  assert.equal(credited.ok, true);
  if (!credited.ok) return;
  assert.equal(credited.gross, "1000000");
  assert.equal(credited.fee, "5000");
  assert.equal(credited.net, "995000");
  assert.equal(credited.receipt.amountLamports, "995000");
  assert.equal(credited.receipt.source, "creator_vault");
  const again = reconcileCreatorFee({
    status: "confirmed",
    signature: "5".repeat(64),
    slot: "20",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: DEPLOYER,
    vaultOutLamports: "1000000",
    networkFeeLamports: "5000",
    unrelatedDepositLamports: "9000000",
    creatorDeltaLamports: "9995000",
    existing: credited.receipts,
  });
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.code, "duplicate");
  const deposit = reconcileCreatorFee({
    status: "confirmed",
    signature: "6".repeat(64),
    slot: "21",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: DEPLOYER,
    vaultOutLamports: "0",
    networkFeeLamports: "0",
    unrelatedDepositLamports: "9000000",
    creatorDeltaLamports: "9000000",
    existing: [],
  });
  assert.equal(deposit.ok, false);
  if (deposit.ok) return;
  assert.equal(deposit.code, "fee_source");
  const pending = reconcileCreatorFee({
    status: "uncertain",
    signature: "7".repeat(64),
    slot: "22",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: OTHER,
    vaultOutLamports: "1000000",
    networkFeeLamports: "5000",
    unrelatedDepositLamports: "0",
    creatorDeltaLamports: "1000000",
    existing: [],
  });
  assert.equal(pending.ok, false);
  if (pending.ok) return;
  assert.equal(pending.code, "unconfirmed");
  const mismatch = reconcileCreatorFee({
    status: "confirmed",
    signature: "8".repeat(64),
    slot: "23",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: DEPLOYER,
    vaultOutLamports: "1000000",
    networkFeeLamports: "5000",
    unrelatedDepositLamports: "0",
    creatorDeltaLamports: "1000000",
    existing: [],
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.code, "unreconciled");
});

test("five-minute windows allocate 30/30/40 once and isolate parents", () => {
  const first = allocateWindow({
    parentMint: TREST,
    scope: "test",
    timestampMs: WINDOW_MS + 10,
    netLamports: "100",
    reserveLamports: "0",
    receiptSignatures: ["5".repeat(64)],
    allocatedSignatures: [],
    existingWindowKeys: [],
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.holders, "30");
  assert.equal(first.buyback, "30");
  assert.equal(first.deployer, "40");
  assert.equal(windowKey(TREST, "test", WINDOW_MS + 10), first.windowKey);
  const restart = allocateWindow({
    parentMint: TREST,
    scope: "test",
    timestampMs: WINDOW_MS + 20,
    netLamports: "100",
    reserveLamports: "0",
    receiptSignatures: ["5".repeat(64)],
    allocatedSignatures: ["5".repeat(64)],
    existingWindowKeys: [first.windowKey],
  });
  assert.equal(restart.ok, true);
  if (!restart.ok) return;
  assert.equal(restart.duplicate, true);
  assert.equal(restart.holders, "0");
  const production = allocateWindow({
    parentMint: SDK,
    scope: "production",
    timestampMs: WINDOW_MS + 10,
    netLamports: "100",
    reserveLamports: "0",
    receiptSignatures: ["9".repeat(64)],
    allocatedSignatures: ["5".repeat(64)],
    existingWindowKeys: [first.windowKey],
  });
  assert.equal(production.ok, true);
  if (!production.ok) return;
  assert.equal(production.duplicate, false);
  assert.equal(production.holders, "30");
  assert.notEqual(production.windowKey, first.windowKey);
  const short = authoriseBucketSpend({
    bucket: "buyback",
    creditedLamports: "100",
    reserveLamports: "90",
    bucketSpentLamports: "0",
    amountLamports: "10",
    cycleSpentLamports: "0",
    cycleCapLamports: "10",
    slippageBps: 100,
    destination: HOLDER,
    allowedDestinations: [HOLDER],
    programs: [PUMP_PROGRAM_ID],
    allowedPrograms: [PUMP_PROGRAM_ID],
    suspended: false,
    walletLamports: "999999999",
  });
  assert.equal(short.ok, false);
  if (short.ok) return;
  assert.equal(short.code, "unfunded");
});

test("buyback and claim intents are recorded before broadcast and uncertain results block a retry", () => {
  const lock = acquireCycleLock(null, { parentMint: TREST, scope: "test", holder: "worker-a" });
  assert.equal(lock.ok, true);
  if (!lock.ok) return;
  const busy = acquireCycleLock(lock.lock, { parentMint: TREST, scope: "test", holder: "worker-b" });
  assert.equal(busy.ok, false);
  const recorded = recordIntent({
    existing: [],
    intent: { idempotencyKey: "buyback-window-1", parentMint: TREST, scope: "test", kind: "buyback" },
  });
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;
  assert.equal(recorded.intents[0]?.status, "recorded");
  assert.equal(recorded.intents[0]?.signature, null);
  const submitted = markSubmitted(recorded.intents, "buyback-window-1", "2".repeat(64));
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  const uncertain = observeIntent(submitted.intents, "buyback-window-1", "uncertain");
  assert.equal(uncertain.ok, true);
  if (!uncertain.ok) return;
  assert.equal(buybackBlocked(uncertain.intents, TREST, "test"), true);
  assert.equal(buybackBlocked(uncertain.intents, SDK, "production"), false);
  const retry = recordIntent({
    existing: uncertain.intents,
    intent: { idempotencyKey: "buyback-window-2", parentMint: TREST, scope: "test", kind: "buyback" },
  });
  assert.equal(retry.ok, false);
  if (retry.ok) return;
  assert.equal(retry.code, "uncertain");
  const failed = reconcileBuyback({ status: "failed", quotedTokenAmount: "1000", tokenDelta: "1000" });
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.code, "failed");
  const estimate = reconcileBuyback({ status: "confirmed", quotedTokenAmount: "1000", tokenDelta: "40" });
  assert.equal(estimate.ok, true);
  if (!estimate.ok) return;
  assert.equal(estimate.credited, "40");
  const short = reconcileBuyback({ status: "confirmed", quotedTokenAmount: "1000", tokenDelta: "0" });
  assert.equal(short.ok, false);
  const released = releaseCycleLock(lock.lock, "worker-a");
  assert.equal(released.ok, true);
});

test("holder snapshots use a 50000 token cutoff and claims cannot exceed it", () => {
  const snapshot = snapshotHolders({
    parentMint: TREST,
    decimals: 6,
    solLamports: "100",
    tokenAmount: "10",
    excludedOwners: [CURVE, DEPLOYER],
    accounts: [
      { owner: HOLDER, mint: TREST, amount: "50000000000" },
      { owner: OTHER, mint: TREST, amount: "49999999999" },
      { owner: CURVE, mint: TREST, amount: "999999999999" },
      { owner: HOLDER, mint: SDK, amount: "999999999999" },
      { owner: DEPLOYER, mint: TREST, amount: "80000000000" },
    ],
  });
  assert.equal(snapshot.ok, true);
  if (!snapshot.ok) return;
  assert.equal(snapshot.holders.length, 1);
  assert.equal(snapshot.holders[0]?.owner, HOLDER);
  assert.equal(snapshot.holders[0]?.solLamports, "100");
  assert.equal(snapshot.holders[0]?.tokenAmount, "10");
  const aggregated = snapshotHolders({
    parentMint: TREST,
    decimals: 6,
    solLamports: "10",
    tokenAmount: "10",
    excludedOwners: [CURVE, DEPLOYER],
    accounts: [
      { owner: HOLDER, mint: TREST, amount: "30000000000" },
      { owner: HOLDER, mint: TREST, amount: "30000000000" },
      { owner: OTHER, mint: TREST, amount: "50000000000" },
    ],
  });
  assert.equal(aggregated.ok, true);
  if (!aggregated.ok) return;
  assert.equal(aggregated.holders.length, 2);
  const holderShare = aggregated.holders.find((row) => row.owner === HOLDER);
  const otherShare = aggregated.holders.find((row) => row.owner === OTHER);
  assert.equal(holderShare?.balance, "60000000000");
  assert.equal(holderShare?.solLamports, "5");
  assert.equal(otherShare?.solLamports, "4");
  assert.equal(aggregated.unallocatedSol, "1");
  const sol = buildSolClaim({
    parentMint: TREST,
    claimParentMint: TREST,
    deployer: DEPLOYER,
    claimant: HOLDER,
    amountLamports: "40",
    entitlementLamports: "100",
    alreadyClaimedLamports: "70",
    idempotencyKey: "claim-sol-holder-0001",
    uncertainKeys: [],
  });
  assert.equal(sol.ok, false);
  if (sol.ok) return;
  assert.equal(sol.code, "unfunded");
  const paid = buildSolClaim({
    parentMint: TREST,
    claimParentMint: TREST,
    deployer: DEPLOYER,
    claimant: HOLDER,
    amountLamports: "30",
    entitlementLamports: "100",
    alreadyClaimedLamports: "70",
    idempotencyKey: "claim-sol-holder-0001",
    uncertainKeys: [],
  });
  assert.equal(paid.ok, true);
  if (!paid.ok) return;
  assert.equal(paid.instruction.programId, "11111111111111111111111111111111");
  assert.equal(paid.instruction.keys[1]?.pubkey, HOLDER);
  const crossed = buildTokenClaim({
    parentMint: TREST,
    claimMint: SDK,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    deployer: DEPLOYER,
    claimant: HOLDER,
    amount: "1",
    decimals: 6,
    entitlement: "10",
    alreadyClaimed: "0",
    idempotencyKey: "claim-trest-holder-001",
    uncertainKeys: [],
  });
  assert.equal(crossed.ok, false);
  if (crossed.ok) return;
  assert.equal(crossed.code, "parent");
  const tokens = buildTokenClaim({
    parentMint: TREST,
    claimMint: TREST,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    deployer: DEPLOYER,
    claimant: HOLDER,
    amount: "4",
    decimals: 6,
    entitlement: "10",
    alreadyClaimed: "0",
    idempotencyKey: "claim-trest-holder-001",
    uncertainKeys: [],
  });
  assert.equal(tokens.ok, true);
  if (!tokens.ok) return;
  assert.equal(tokens.instruction.programId, TOKEN_2022_PROGRAM_ID);
  assert.equal(tokens.instruction.data[0], 12);
  assert.equal(new PublicKey(tokens.instruction.keys[1]?.pubkey ?? "").toBase58(), TREST);
  const blocked = buildTokenClaim({
    parentMint: TREST,
    claimMint: TREST,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    deployer: DEPLOYER,
    claimant: HOLDER,
    amount: "1",
    decimals: 6,
    entitlement: "10",
    alreadyClaimed: "0",
    idempotencyKey: "claim-trest-holder-002",
    uncertainKeys: [`${HOLDER}:token`],
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "uncertain");
});

test("the signer checks the compiled transaction and rejects a mismatched or suspended key", () => {
  const pair = nacl.sign.keyPair();
  const secret = bs58.encode(pair.secretKey);
  const address = new PublicKey(pair.publicKey).toBase58();
  const blockhash = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const claim = buildSolClaim({
    parentMint: TREST,
    claimParentMint: TREST,
    deployer: address,
    claimant: HOLDER,
    amountLamports: "30",
    entitlementLamports: "30",
    alreadyClaimedLamports: "0",
    idempotencyKey: "claim-sol-holder-0001",
    uncertainKeys: [],
  });
  assert.equal(claim.ok, true);
  if (!claim.ok) return;
  const transaction = { feePayer: address, recentBlockhash: blockhash, instructions: [claim.instruction] };
  const policy = {
    kind: "claim_sol" as const,
    scope: "test" as const,
    parentMint: TREST,
    deployer: address,
    recipient: HOLDER,
    maxLamports: "30",
    maxRentLamports: "0",
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  const signed = signInspected({ secret, expectedAddress: address, suspended: false, transaction, policy });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  assert.equal(nacl.sign.detached.verify(signed.message, bs58.decode(signed.signature), pair.publicKey), true);
  assert.equal(JSON.stringify(signed).includes(secret), false);
  const mismatch = signInspected({ secret, expectedAddress: DEPLOYER, suspended: false, transaction, policy });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.code, "signer_mismatch");
  const suspended = signInspected({ secret, expectedAddress: address, suspended: true, transaction, policy });
  assert.equal(suspended.ok, false);
  if (suspended.ok) return;
  assert.equal(suspended.code, "suspended");
  const diverted = buildSolClaim({
    parentMint: TREST,
    claimParentMint: TREST,
    deployer: address,
    claimant: OTHER,
    amountLamports: "30",
    entitlementLamports: "30",
    alreadyClaimedLamports: "0",
    idempotencyKey: "claim-sol-holder-0002",
    uncertainKeys: [],
  });
  assert.equal(diverted.ok, true);
  if (!diverted.ok) return;
  const arbitrary = signInspected({
    secret,
    expectedAddress: address,
    suspended: false,
    transaction: { feePayer: address, recentBlockhash: blockhash, instructions: [diverted.instruction] },
    policy,
  });
  assert.equal(arbitrary.ok, false);
  if (arbitrary.ok) return;
  assert.equal(arbitrary.code, "destination");
  assert.equal(rewardsExecutionEnabled({ loopEnabled: "true", executionAuthorised: null, suspended: false }), false);
  assert.equal(rewardsExecutionEnabled({ loopEnabled: "true", executionAuthorised: "true", suspended: true }), false);
  assert.equal(rewardsExecutionEnabled({ loopEnabled: "true", executionAuthorised: "true", suspended: false }), true);
});

test("wrapped SOL is credited only after a verified close and rent is excluded", () => {
  const closed = reconcileCreatorFee({
    status: "confirmed",
    signature: "7".repeat(64),
    slot: "30",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: DEPLOYER,
    vaultOutLamports: "0",
    networkFeeLamports: "5000",
    unrelatedDepositLamports: "0",
    creatorDeltaLamports: "2034880",
    wsolTokenOut: "2000000",
    wsolClosedLamports: "2039880",
    wsolRentLamports: "39880",
    existing: [],
  });
  assert.equal(closed.ok, true);
  if (!closed.ok) return;
  assert.equal(closed.native, "0");
  assert.equal(closed.wsolConverted, "2000000");
  assert.equal(closed.rentExcluded, "39880");
  assert.equal(closed.net, "1995000");
  const unconverted = reconcileCreatorFee({
    status: "confirmed",
    signature: "8".repeat(64),
    slot: "31",
    parentMint: TREST,
    scope: "test",
    creator: DEPLOYER,
    feePayer: DEPLOYER,
    vaultOutLamports: "0",
    networkFeeLamports: "5000",
    unrelatedDepositLamports: "0",
    creatorDeltaLamports: "0",
    wsolTokenOut: "2000000",
    wsolClosedLamports: "0",
    wsolRentLamports: "0",
    existing: [],
  });
  assert.equal(unconverted.ok, false);
  if (unconverted.ok) return;
  assert.equal(unconverted.code, "wsol");
});

test("incremental windows split only new fees and withhold the reserve once", () => {
  const first = planIncrementalAllocation({ grossLamports: "100", reserveLamports: "0", reserveWithheldLamports: "0" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual([first.holders, first.buyback, first.deployer], ["30", "30", "40"]);
  const second = planIncrementalAllocation({ grossLamports: "50", reserveLamports: "0", reserveWithheldLamports: "0" });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual([second.holders, second.buyback, second.deployer], ["15", "15", "20"]);
  const opening = planIncrementalAllocation({ grossLamports: "100", reserveLamports: "90", reserveWithheldLamports: "0" });
  assert.equal(opening.ok, true);
  if (!opening.ok) return;
  assert.equal(opening.withheld, "90");
  assert.deepEqual([opening.holders, opening.buyback, opening.deployer], ["3", "3", "4"]);
  const later = planIncrementalAllocation({ grossLamports: "100", reserveLamports: "90", reserveWithheldLamports: "90" });
  assert.equal(later.ok, true);
  if (!later.ok) return;
  assert.equal(later.withheld, "0");
  assert.deepEqual([later.holders, later.buyback, later.deployer], ["30", "30", "40"]);
  const dust = planIncrementalAllocation({ grossLamports: "10", reserveLamports: "0", reserveWithheldLamports: "0" });
  assert.equal(dust.ok, true);
  if (!dust.ok) return;
  assert.deepEqual([dust.holders, dust.buyback, dust.deployer], ["3", "3", "4"]);
  const empty = planIncrementalAllocation({ grossLamports: "0", reserveLamports: "0", reserveWithheldLamports: "0" });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.deepEqual([empty.base, empty.holders, empty.buyback, empty.deployer], ["0", "0", "0", "0"]);
});

test("a buyback cannot spend SOL reserved for holders, the deployer, or an earlier buyback", () => {
  const covered = buybackSpendAllowed({
    walletLamports: "100",
    buybackLamports: "30",
    reserveLamports: "0",
    unpaidHolderLamports: "30",
    deployerRetainedLamports: "40",
    unspentPriorBuybackLamports: "0",
    deferredHolderLamports: "0",
    deferredBuybackLamports: "0",
    deferredDeployerLamports: "0",
  });
  assert.equal(covered.ok, true);
  const short = buybackSpendAllowed({
    walletLamports: "60",
    buybackLamports: "30",
    reserveLamports: "0",
    unpaidHolderLamports: "30",
    deployerRetainedLamports: "40",
    unspentPriorBuybackLamports: "0",
    deferredHolderLamports: "0",
    deferredBuybackLamports: "0",
    deferredDeployerLamports: "0",
  });
  assert.equal(short.ok, false);
  if (short.ok) return;
  assert.equal(short.code, "unfunded");
  const reserved = buybackSpendAllowed({
    walletLamports: "100",
    buybackLamports: "30",
    reserveLamports: "5",
    unpaidHolderLamports: "30",
    deployerRetainedLamports: "40",
    unspentPriorBuybackLamports: "0",
    deferredHolderLamports: "0",
    deferredBuybackLamports: "0",
    deferredDeployerLamports: "0",
  });
  assert.equal(reserved.ok, false);
  const net = "85140307";
  const deferred = {
    deferredHolderLamports: "24042092",
    deferredBuybackLamports: "24042092",
    deferredDeployerLamports: "32056123",
  };
  const protectedCollection = buybackSpendAllowed({
    walletLamports: net,
    buybackLamports: "1",
    reserveLamports: "5000000",
    unpaidHolderLamports: "0",
    deployerRetainedLamports: "0",
    unspentPriorBuybackLamports: "0",
    ...deferred,
  });
  assert.equal(protectedCollection.ok, false);
  const unrelated = buybackSpendAllowed({
    walletLamports: (BigInt(net) + BigInt(30)).toString(),
    buybackLamports: "30",
    reserveLamports: "5000000",
    unpaidHolderLamports: "0",
    deployerRetainedLamports: "0",
    unspentPriorBuybackLamports: "0",
    ...deferred,
  });
  assert.equal(unrelated.ok, true);
  const countedTwice = buybackSpendAllowed({
    walletLamports: (BigInt(net) + BigInt(30)).toString(),
    buybackLamports: "30",
    reserveLamports: "5000000",
    unpaidHolderLamports: deferred.deferredHolderLamports,
    deployerRetainedLamports: deferred.deferredDeployerLamports,
    unspentPriorBuybackLamports: deferred.deferredBuybackLamports,
    ...deferred,
  });
  assert.equal(countedTwice.ok, false);
  const floor = {
    walletLamports: net,
    spendLamports: deferred.deferredBuybackLamports,
    budgetLamports: deferred.deferredBuybackLamports,
    pendingLamports: "0",
    reserveLamports: "5000000",
    unpaidHolderLamports: "0",
    deployerRetainedLamports: "0",
    unspentPriorBuybackLamports: "0",
    ...deferred,
  };
  assert.equal(reservedBuybackSpendAllowed(floor).ok, true);
  assert.equal(reservedBuybackSpendAllowed({ ...floor, walletLamports: (BigInt(net) - BigInt(1)).toString() }).ok, false);
  assert.equal(reservedBuybackSpendAllowed({ ...floor, pendingLamports: deferred.deferredBuybackLamports }).ok, false);
  assert.equal(reservedBuybackSpendAllowed({ ...floor, spendLamports: (BigInt(deferred.deferredBuybackLamports) + BigInt(1)).toString() }).ok, false);
  const quoted = quoteInsideBuybackBudget({ budgetLamports: deferred.deferredBuybackLamports, networkFeeLamports: "5000", rentLamports: "2039280" });
  assert.equal(quoted.ok, true);
  if (!quoted.ok) return;
  assert.equal(quoted.quoteLamports, (BigInt(deferred.deferredBuybackLamports) - BigInt(5000) - BigInt(2039280)).toString());
  assert.equal(quoteInsideBuybackBudget({ budgetLamports: "5000", networkFeeLamports: "5000", rentLamports: "0" }).ok, false);
});
