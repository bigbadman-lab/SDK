import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "../launch/fees.ts";
import { publicLaunchScope } from "../launch/parent-scope.ts";
import { approvalMatches, type StoredLaunchBuild } from "../launch/submit-plan.ts";
import { TREST_MINT } from "../launch/verified-launch.ts";
import { presentCreatorReceipt } from "./earnings-display.ts";
import { matchShareholderReceipts, splitChildFee, verifyChildSharing } from "./child-fees.ts";
import { presentProductionStatus } from "./production.ts";
import {
  DNA_MINT,
  VENT_MINT,
  acceptProductionChild,
  acceptedLaunchApproval,
  productionChildBatch,
  productionChildFeeControl,
  receiptRole,
  reserveChildDistribution,
  type ProductionChildRow,
} from "./child-fee-gate.ts";

const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const CHILD = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const LAUNCHER = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";
const ORIGINATOR = "So11111111111111111111111111111111111111112";
const SIGNATURE = "kEF7JqpqgybWQAapWxkkEvoyaud2yNKb3FvNTNVtfy7au4Z1RYH2g4s62ZbNWpSk3gcv4PZs4w1se4a3Tjg3PGE";
const VENT_VAULT = "9NXoqw9svrX4kD3bRkxQuyV5bkxeQugLgkJr2z5EnXjw";

function row(overrides: Partial<ProductionChildRow> = {}): ProductionChildRow {
  return {
    mint: CHILD,
    quoteMint: SDK,
    buildQuote: SDK,
    scope: "production",
    category: "official",
    launcher: LAUNCHER,
    originator: null,
    attemptStatus: "verified",
    submissionStatus: "page_ready",
    ...overrides,
  };
}

function armed(overrides: Partial<Parameters<typeof productionChildFeeControl>[0]> = {}) {
  return productionChildFeeControl({
    canonicalMint: SDK,
    childFeesActive: true,
    launchesActive: false,
    rewardsActive: false,
    executionAuthorised: true,
    signerMatched: true,
    suspended: false,
    emergencyFence: false,
    shuttingDown: false,
    ...overrides,
  });
}

function storedBuild(overrides: Partial<StoredLaunchBuild> = {}): StoredLaunchBuild {
  return {
    launchId: "11111111-1111-4111-8111-111111111111",
    buildId: "22222222-2222-4222-8222-222222222222",
    accountId: "33333333-3333-4333-8333-333333333333",
    wallet: LAUNCHER,
    childMint: CHILD,
    parentMint: SDK,
    scope: "production",
    messageHash: "a".repeat(64),
    blockhash: "blockhash",
    expiresAt: 1,
    metadataUri: "https://sdk.fund/metadata.json",
    buyAmount: "1",
    shareholders: [],
    category: "official",
    originatorWallet: null,
    productionParentRegistered: true,
    status: "built",
    ...overrides,
  };
}

test("verified production children are discovered and historical or mismatched children are not", () => {
  const accepted = acceptProductionChild(row(), SDK);
  assert.equal(accepted?.scope, "production");
  assert.equal(accepted?.quoteMint, SDK);
  assert.equal(accepted?.category, "official");
  assert.equal(acceptProductionChild(row({ attemptStatus: "page_ready", submissionStatus: "verified" }), SDK)?.mint, CHILD);
  assert.equal(acceptProductionChild(row({ mint: VENT_MINT }), SDK), null);
  assert.equal(acceptProductionChild(row({ mint: DNA_MINT }), SDK), null);
  assert.equal(acceptProductionChild(row({ mint: TREST_MINT }), SDK), null);
  assert.equal(acceptProductionChild(row({ scope: "test" }), SDK), null);
  assert.equal(acceptProductionChild(row({ quoteMint: TREST_MINT, buildQuote: TREST_MINT }), SDK), null);
  assert.equal(acceptProductionChild(row({ quoteMint: CHILD }), SDK), null);
  assert.equal(acceptProductionChild(row({ buildQuote: CHILD }), SDK), null);
  assert.equal(acceptProductionChild(row({ attemptStatus: "ready_to_sign" }), SDK), null);
  assert.equal(acceptProductionChild(row({ submissionStatus: "rejected" }), SDK), null);
  assert.equal(acceptProductionChild(row({ category: "holder_rewards" }), SDK), null);
  assert.equal(acceptProductionChild(row(), null), null);
  assert.equal(acceptProductionChild(row(), TREST_MINT), null);
});

test("child-fee execution is independent of parent rewards and public launches", () => {
  assert.deepEqual(armed(), { reconcile: true, distribute: true });
  assert.deepEqual(armed({ rewardsActive: false, launchesActive: true, childFeesActive: false }), {
    reconcile: true,
    distribute: false,
  });
  assert.deepEqual(armed({ suspended: true }), { reconcile: true, distribute: false });
  assert.deepEqual(armed({ signerMatched: false }), { reconcile: true, distribute: false });
  assert.deepEqual(armed({ executionAuthorised: false }), { reconcile: true, distribute: false });
  assert.deepEqual(armed({ shuttingDown: true }), { reconcile: true, distribute: false });
  assert.deepEqual(armed({ canonicalMint: null }), { reconcile: false, distribute: false });
  assert.deepEqual(armed({ canonicalMint: TREST_MINT, childFeesActive: true, rewardsActive: true, launchesActive: true }), {
    reconcile: false,
    distribute: false,
  });
  const status = presentProductionStatus({
    canonicalMint: SDK,
    signer: "matched",
    rewardsActive: false,
    loopRunning: true,
    broadcastsEnabled: false,
    lastWindow: null,
    reconciliation: "clear",
    claimsReady: false,
    childFeesEnabled: true,
    launchesActive: true,
    childFeeReconciliation: "outstanding",
  });
  assert.equal(status.rewards, "inactive");
  assert.equal(status.broadcasts, "disabled");
  assert.equal(status.childFees, "enabled");
  assert.equal(status.launches, "active");
  assert.equal(status.distributor, "present");
  assert.equal(status.childFeeReconciliation, "outstanding");
  const closed = presentProductionStatus({
    canonicalMint: null,
    signer: "suspended",
    rewardsActive: false,
    loopRunning: false,
    broadcastsEnabled: false,
    lastWindow: null,
    reconciliation: "unknown",
    claimsReady: false,
    launchesActive: true,
    childFeesEnabled: true,
  });
  assert.equal(closed.childFees, "disabled");
  assert.equal(closed.launches, "inactive");
  assert.equal(closed.distributor, "present");
});

test("all three schedules are verified on chain and a different schedule is rejected", () => {
  const official = verifyChildSharing({
    category: "official",
    launcherWallet: LAUNCHER,
    originatorWallet: null,
    adminRevoked: true,
    observed: [
      { address: LAUNCHER, shareBps: 6000 },
      { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
    ],
  });
  const originator = verifyChildSharing({
    category: "originator_launch",
    launcherWallet: LAUNCHER,
    originatorWallet: LAUNCHER,
    adminRevoked: true,
    observed: [
      { address: LAUNCHER, shareBps: 8500 },
      { address: PLATFORM_FEE_WALLET, shareBps: 1500 },
    ],
  });
  const community = verifyChildSharing({
    category: "community_split",
    launcherWallet: LAUNCHER,
    originatorWallet: ORIGINATOR,
    adminRevoked: true,
    observed: [
      { address: LAUNCHER, shareBps: 6000 },
      { address: ORIGINATOR, shareBps: 2500 },
      { address: PLATFORM_FEE_WALLET, shareBps: 1500 },
    ],
  });
  assert.equal(official.ok && originator.ok && community.ok, true);
  assert.equal(verifyChildSharing({
    category: "community_split",
    launcherWallet: LAUNCHER,
    originatorWallet: ORIGINATOR,
    adminRevoked: true,
    observed: [
      { address: LAUNCHER, shareBps: 6000 },
      { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
    ],
  }).ok, false);
  assert.equal(verifyChildSharing({
    category: "official",
    launcherWallet: LAUNCHER,
    originatorWallet: null,
    adminRevoked: false,
    observed: [
      { address: LAUNCHER, shareBps: 6000 },
      { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
    ],
  }).ok, false);
  if (!community.ok) return;
  assert.equal(receiptRole({ address: LAUNCHER, launcher: LAUNCHER, originator: ORIGINATOR }), "launcher");
  assert.equal(receiptRole({ address: ORIGINATOR, launcher: LAUNCHER, originator: ORIGINATOR }), "developer");
  assert.equal(receiptRole({ address: PLATFORM_FEE_WALLET, launcher: LAUNCHER, originator: ORIGINATOR }), "platform");
  assert.equal(receiptRole({ address: CHILD, launcher: LAUNCHER, originator: ORIGINATOR }), null);
});

test("receipt matching keeps Pump's independent floor and the confirmed VENT amounts", () => {
  const shareholders = [
    { address: LAUNCHER, shareBps: 6000 },
    { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
  ];
  const floored = matchShareholderReceipts({
    quoteMint: SDK,
    shareholders,
    distributed: "10000",
    deltas: [
      { owner: VENT_VAULT, mint: SDK, amount: "10000", sign: "debit" },
      { owner: LAUNCHER, mint: SDK, amount: "6000", sign: "credit" },
      { owner: PLATFORM_FEE_WALLET, mint: SDK, amount: "4000", sign: "credit" },
    ],
  });
  assert.equal(floored.ok, true);
  const remainder = splitChildFee("10001", shareholders);
  assert.equal(remainder.ok, true);
  if (!remainder.ok) return;
  const platformRemainder = remainder.shares.find((share) => share.address === PLATFORM_FEE_WALLET);
  assert.equal(platformRemainder?.amount, "4001");
  assert.equal(matchShareholderReceipts({
    quoteMint: SDK,
    shareholders,
    distributed: "10001",
    deltas: [
      { owner: VENT_VAULT, mint: SDK, amount: "10001", sign: "debit" },
      { owner: LAUNCHER, mint: SDK, amount: "6000", sign: "credit" },
      { owner: PLATFORM_FEE_WALLET, mint: SDK, amount: "4001", sign: "credit" },
    ],
  }).ok, false);
  const vent = matchShareholderReceipts({
    quoteMint: TREST_MINT,
    shareholders,
    distributed: "135936184193",
    deltas: [
      { owner: VENT_VAULT, mint: TREST_MINT, amount: "135936184193", sign: "debit" },
      { owner: LAUNCHER, mint: TREST_MINT, amount: "81561710516", sign: "credit" },
      { owner: PLATFORM_FEE_WALLET, mint: TREST_MINT, amount: "54374473677", sign: "credit" },
    ],
  });
  assert.equal(vent.ok, true);
  if (!vent.ok) return;
  assert.equal(vent.receipts.find((receipt) => receipt.address === PLATFORM_FEE_WALLET)?.amount, "54374473677");
});

test("an existing distribution intent blocks another submission for that window", () => {
  assert.equal(reserveChildDistribution(null), "reserve");
  for (const status of ["submitted", "confirmed", "uncertain", "unreconciled", "failed"]) {
    assert.equal(reserveChildDistribution({ status }), "blocked");
  }
  const children = Array.from({ length: 10 }, (_, index) => ({ scope: "production" as const, mint: `child-${index}` }));
  const completed = ["child:production:child-0:1000"];
  const batch = productionChildBatch(children, completed, 1000);
  assert.equal(batch.length, 8);
  assert.equal(batch.some((child) => child.mint === "child-0"), false);
  assert.equal(batch.some((child) => child.mint === "child-8"), true);
  assert.equal(batch.some((child) => child.mint === "child-9"), false);
});

test("production account receipts use SDK decimals and never present an unconfirmed row as paid", () => {
  const shown = presentCreatorReceipt({
    role: "launcher",
    scope: "production",
    mint: SDK,
    amount: "1500000",
    signature: SIGNATURE,
    childMint: CHILD,
    quoteSymbol: "SDK",
    quoteDecimals: 6,
    childSymbol: "CHILD",
    receivedAt: "2026-10-26T12:00:00.000Z",
  });
  assert.equal(shown?.headline, "1.5 SDK");
  assert.equal(shown?.status, "Confirmed");
  assert.equal(presentCreatorReceipt({
    role: "launcher",
    scope: "production",
    mint: SDK,
    amount: "1500000",
    signature: null,
    quoteSymbol: "SDK",
    quoteDecimals: 6,
  }), null);
  const account = readFileSync(new URL("../server/rewards/account.ts", import.meta.url), "utf8");
  assert.match(account, /distribution\.scope = 'production' and parent\.symbol = 'SDK'/);
});

test("production launch approval stays bound to the platform wallet, the build, and the canonical parent", () => {
  const build = storedBuild();
  const approval = {
    launchId: build.launchId,
    buildId: build.buildId,
    parentMint: SDK,
    scope: "production" as const,
    approver: PLATFORM_FEE_WALLET,
  };
  assert.equal(approvalMatches(build, approval), true);
  assert.equal(approvalMatches(build, { ...approval, buildId: "33333333-3333-4333-8333-333333333334" }), false);
  assert.equal(approvalMatches(build, { ...approval, approver: LAUNCHER }), false);
  assert.equal(approvalMatches(build, { ...approval, parentMint: TREST_MINT }), false);
  assert.equal(approvalMatches(storedBuild({ productionParentRegistered: false }), approval), false);
  assert.equal(acceptedLaunchApproval({ scope: "test", approver: LAUNCHER, parentMint: TREST_MINT }), true);
  assert.equal(acceptedLaunchApproval({ scope: "production", approver: LAUNCHER, parentMint: SDK }), false);
  assert.equal(publicLaunchScope({ scope: "test", launchId: build.launchId, mintPublicKey: CHILD }).ok, false);
  assert.equal(publicLaunchScope({ parentMint: TREST_MINT, launchId: build.launchId, mintPublicKey: CHILD }).ok, false);
  const official = allocateCreatorFees({
    category: "official",
    launcherWallet: LAUNCHER,
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  const community = allocateCreatorFees({
    category: "community_split",
    launcherWallet: LAUNCHER,
    originatorWallet: ORIGINATOR,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  assert.equal(official.ok && community.ok, true);
  if (!official.ok || !community.ok) return;
  assert.equal(official.shareholders.some((share) => share.shareBps === 8500), false);
  assert.equal(community.shareholders.some((share) => share.address === ORIGINATOR && share.shareBps === 2500), true);
  const unsigned = readFileSync(new URL("../server/launch/unsigned.ts", import.meta.url), "utf8");
  const insertAt = unsigned.indexOf("insert into launch_approvals");
  assert.ok(unsigned.indexOf("acceptCanonicalLaunchParent") < insertAt);
  assert.ok(unsigned.indexOf("readPublicLaunchGate()") < insertAt);
  assert.match(unsigned.slice(insertAt, insertAt + 400), /'production'/);
  assert.match(unsigned.slice(insertAt, insertAt + 400), /PLATFORM_FEE_WALLET/);
  const rehearsal = readFileSync(new URL("../server/launch/submit.ts", import.meta.url), "utf8");
  assert.match(rehearsal, /build\.scope !== "test"/);
  assert.match(rehearsal, /acceptedLaunchApproval/);
  const plan = readFileSync(new URL("../launch/submit-plan.ts", import.meta.url), "utf8");
  assert.match(plan, /verifySignedCommitment/);
  assert.match(plan, /allocateCreatorFees/);
  const distributor = readFileSync(new URL("../../services/rewards-worker/src/production-child-fees.ts", import.meta.url), "utf8");
  const submitAt = distributor.lastIndexOf("input.chain.submit");
  assert.ok(distributor.lastIndexOf("shutdownRequested()", submitAt) < submitAt);
  assert.ok(distributor.lastIndexOf("on conflict (idempotency_key) do nothing", submitAt) < submitAt);
  assert.equal(distributor.includes("parent_scope = 'test'"), false);
  assert.match(distributor, /parent_scope = 'production'/);
  assert.match(distributor, /quote_mint_address = \$\{input\.canonicalMint\}/);
  const migration = readFileSync(new URL("../../supabase/migrations/20261026210000_sdk_prod_03c_child_fees_active.sql", import.meta.url), "utf8");
  assert.match(migration, /child_fees_active boolean not null default false/);
  assert.match(migration, /child fees require a canonical mint/);
  assert.equal(migration.includes("update public.sdk_parent_config"), false);
});
