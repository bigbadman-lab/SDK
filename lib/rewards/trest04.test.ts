import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { PLATFORM_FEE_WALLET } from "../launch/fees.ts";
import { claimAllPlan, claimAllResults, isolatedProduction, rewardsView } from "./account-view.ts";
import { childDistributionInstruction, DISTRIBUTE_CREATOR_FEES_V2, matchShareholderReceipts, nativeCollectionInstruction, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, splitChildFee, SWEEP_CREATOR_FEE, TRANSFER_CREATOR_FEES_TO_PUMP_V2, verifyChildSharing } from "./child-fees.ts";
import { inspectRewardsTransaction } from "./inspect.ts";
import { boundClaimMessage, parseBoundClaim } from "./ownership.ts";
import { financialGate, infrastructureGate } from "./readiness.ts";
import { nextUtcWindowDelay, ordinaryWorkAllowed } from "./schedule.ts";
import { authoriseSweep, openSweep, planSweep, settleSweep, sweepExecutionAuthorised, transferableLamports } from "./sweep.ts";

const TREST = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const DEPLOYER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const HOLDER = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const LAUNCHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const DESTINATION = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";

const liabilities = {
  claimableSol: "0",
  claimableToken: "0",
  deployerRetained: "0",
  unspentBuyback: "0",
  unallocated: "0",
};

test("five-minute scheduling follows the UTC window and emergency fences ordinary work", () => {
  const start = Date.UTC(2026, 9, 20, 16, 0, 0);
  assert.equal(nextUtcWindowDelay(start), 300_000);
  assert.equal(nextUtcWindowDelay(start + 299_000), 1_000);
  assert.equal(ordinaryWorkAllowed({ suspended: true, emergencyFence: false }), false);
  assert.equal(ordinaryWorkAllowed({ suspended: false, emergencyFence: true }), false);
});

test("account rewards keep production separate from TREST and report partial claims", () => {
  const view = rewardsView({
    scope: "production",
    symbol: null,
    ledger: "ready",
    worker: "suspended",
    snapshots: [
      { owner: HOLDER, balance: "100", solLamports: "30", tokenAmount: "10", windowKey: "test:old" },
    ],
    claims: [],
    windows: [],
    wallet: HOLDER,
    threshold: "50",
    currentBalance: null,
    earnings: [
      { role: "launcher", scope: "test", mint: TREST, amount: "5", signature: null },
      { role: "developer", scope: "production", mint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa", amount: "2", signature: null },
    ],
  });
  assert.equal(isolatedProduction(view), true);
  assert.equal(view.symbol, null);
  assert.equal(view.claimableSol, "30");
  assert.equal(view.earnings.length, 1);
  assert.equal(view.earnings[0]?.scope, "production");
  assert.equal(view.currentBalance, null);
  const partial = claimAllResults([
    { asset: "sol", ok: true, code: "confirmed" },
    { asset: "parent_token", ok: false, code: "failed" },
  ]);
  assert.equal(partial.outcome, "partial");
  assert.equal(claimAllResults([
    { asset: "sol", ok: false, code: "unavailable" },
    { asset: "parent_token", ok: false, code: "unavailable" },
  ]).outcome, "unavailable");
});

test("a bound claim expires and stays tied to its domain", () => {
  const message = boundClaimMessage({
    domain: "sdk.fund",
    scope: "test",
    parentMint: TREST,
    claimant: HOLDER,
    asset: "sol",
    idempotencyKey: "claim-key-00000001",
    amount: "10",
    nonce: "nonce-value-0000001",
    expiresAt: 1_700_000_000_000,
  });
  assert.ok(message);
  const parsed = parseBoundClaim(message ?? "");
  assert.equal(parsed?.domain, "sdk.fund");
  assert.equal(parsed?.expiresAt, 1_700_000_000_000);
  assert.equal(parseBoundClaim(`${message}\nExtra: 1`), null);
});

test("child fee sharing uses the locked splits and rejects native collection", () => {
  const community = verifyChildSharing({
    category: "community_split",
    launcherWallet: LAUNCHER,
    originatorWallet: HOLDER,
    adminRevoked: true,
    observed: [
      { address: LAUNCHER, shareBps: 6000 },
      { address: HOLDER, shareBps: 2500 },
      { address: PLATFORM_FEE_WALLET, shareBps: 1500 },
    ],
  });
  assert.equal(community.ok, true);
  if (!community.ok) return;
  const split = splitChildFee("10000", community.shareholders);
  assert.equal(split.ok, true);
  if (!split.ok) return;
  assert.deepEqual(
    split.shares.map((row) => row.amount).sort(),
    ["1500", "2500", "6000"],
  );
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
  assert.equal(nativeCollectionInstruction([207, 17, 138, 242, 4, 34, 19, 56]), true);
  assert.equal(childDistributionInstruction([255, 203, 19, 79, 244, 68, 8, 159]), true);
});

test("shared distribution instructions cannot reuse native fee collection", () => {
  const blockhash = bs58.encode(Buffer.alloc(32, 7));
  const accepted = inspectRewardsTransaction(
    {
      feePayer: DEPLOYER,
      recentBlockhash: blockhash,
      instructions: [
        { programId: PUMP_PROGRAM_ID, keys: [], data: [...SWEEP_CREATOR_FEE] },
        { programId: PUMP_PROGRAM_ID, keys: [], data: [...DISTRIBUTE_CREATOR_FEES_V2] },
      ],
    },
    {
      kind: "child_distribute",
      scope: "test",
      parentMint: TREST,
      deployer: DEPLOYER,
      recipient: DEPLOYER,
      maxLamports: "0",
      maxRentLamports: "50000000",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    },
  );
  assert.equal(accepted.ok, true);
  const graduated = inspectRewardsTransaction(
    {
      feePayer: DEPLOYER,
      recentBlockhash: blockhash,
      instructions: [
        { programId: PUMP_PROGRAM_ID, keys: [], data: [...SWEEP_CREATOR_FEE] },
        { programId: PUMP_AMM_PROGRAM_ID, keys: [], data: [...SWEEP_CREATOR_FEE] },
        { programId: PUMP_AMM_PROGRAM_ID, keys: [], data: [...TRANSFER_CREATOR_FEES_TO_PUMP_V2] },
        { programId: PUMP_PROGRAM_ID, keys: [], data: [...DISTRIBUTE_CREATOR_FEES_V2] },
      ],
    },
    {
      kind: "child_distribute",
      scope: "test",
      parentMint: TREST,
      deployer: DEPLOYER,
      recipient: DEPLOYER,
      maxLamports: "0",
      maxRentLamports: "50000000",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    },
  );
  assert.equal(graduated.ok, true);
  const feeProgram = inspectRewardsTransaction(
    {
      feePayer: DEPLOYER,
      recentBlockhash: blockhash,
      instructions: [
        { programId: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", keys: [], data: [...DISTRIBUTE_CREATOR_FEES_V2] },
      ],
    },
    {
      kind: "child_distribute",
      scope: "test",
      parentMint: TREST,
      deployer: DEPLOYER,
      recipient: DEPLOYER,
      maxLamports: "0",
      maxRentLamports: "50000000",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    },
  );
  assert.equal(feeProgram.ok, false);
  const rejected = inspectRewardsTransaction(
    {
      feePayer: DEPLOYER,
      recentBlockhash: blockhash,
      instructions: [
        { programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", keys: [], data: [207, 17, 138, 242, 4, 34, 19, 56] },
      ],
    },
    {
      kind: "child_distribute",
      scope: "test",
      parentMint: TREST,
      deployer: DEPLOYER,
      recipient: DEPLOYER,
      maxLamports: "0",
      maxRentLamports: "0",
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    },
  );
  assert.equal(rejected.ok, false);
});

test("a full sweep records liabilities without reducing the transferable balance", () => {
  assert.equal(sweepExecutionAuthorised(undefined), false);
  assert.equal(sweepExecutionAuthorised("true"), true);
  assert.equal(transferableLamports("10000000", "890880", "5000"), "9104120");
  const plan = planSweep({
    parent: "trest",
    destination: DESTINATION,
    signer: DEPLOYER,
    solBalance: "10000000",
    rentMinimum: "890880",
    feeReserve: "5000",
    tokenBalance: "250000",
    liabilities: { ...liabilities, claimableSol: "3000000", claimableToken: "1000", deployerRetained: "4000000" },
    inFlightClaim: false,
    inFlightBuyback: false,
    suspended: false,
    alreadyExecuted: false,
  });
  assert.ok(!("ok" in plan));
  if ("ok" in plan) return;
  assert.equal(plan.solLamports, "9104120");
  const protectedSweep = planSweep({
    parent: "trest",
    destination: DESTINATION,
    signer: DEPLOYER,
    solBalance: "10000000",
    rentMinimum: "890880",
    feeReserve: "5000",
    tokenBalance: "0",
    liabilities: { ...liabilities, unallocated: "80140307" },
    inFlightClaim: false,
    inFlightBuyback: false,
    suspended: false,
    alreadyExecuted: false,
  });
  assert.ok(!("ok" in protectedSweep));
  if ("ok" in protectedSweep) return;
  const blockedSweep = authoriseSweep({
    requested: "execute",
    executionEnabled: true,
    liabilityAuthorised: true,
    approval: "a".repeat(32),
    plan: protectedSweep,
    parent: "trest",
    signer: DEPLOYER,
    destination: DESTINATION,
  });
  assert.deepEqual(blockedSweep, { ok: false, code: "deferred_protected" });
  assert.equal(plan.tokenAmount, "250000");
  assert.equal(plan.shortfall, true);
  assert.equal(plan.liabilities.claimableSol, "3000000");
  const blocked = authoriseSweep({
    requested: "execute",
    executionEnabled: true,
    liabilityAuthorised: false,
    approval: "a".repeat(32),
    plan,
    parent: "trest",
    signer: DEPLOYER,
    destination: DESTINATION,
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "holder_liability_unauthorised");
  const clear = { ...plan, shortfall: false, liabilities: { ...plan.liabilities, claimableSol: "0", claimableToken: "0" } };
  const unapproved = authoriseSweep({
    requested: "execute",
    executionEnabled: true,
    liabilityAuthorised: false,
    approval: null,
    plan: clear,
    parent: "trest",
    signer: DEPLOYER,
    destination: DESTINATION,
  });
  assert.equal(unapproved.ok, false);
  if (unapproved.ok) return;
  assert.equal(unapproved.code, "approval_required");
  const duplicate = authoriseSweep({
    requested: "execute",
    executionEnabled: true,
    liabilityAuthorised: false,
    approval: "a".repeat(32),
    plan: { ...clear, duplicate: true },
    parent: "trest",
    signer: DEPLOYER,
    destination: DESTINATION,
  });
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.code, "duplicate");
  const locked = authoriseSweep({
    requested: "execute",
    executionEnabled: true,
    liabilityAuthorised: false,
    approval: "a".repeat(32),
    plan: { ...clear, locked: true },
    parent: "trest",
    signer: DEPLOYER,
    destination: DESTINATION,
  });
  assert.equal(locked.ok, false);
  if (locked.ok) return;
  assert.equal(locked.code, "locked");
  const wrongDestination = authoriseSweep({
    requested: "dry-run",
    executionEnabled: false,
    liabilityAuthorised: false,
    approval: null,
    plan,
    parent: "trest",
    signer: DEPLOYER,
    destination: HOLDER,
  });
  assert.equal(wrongDestination.ok, false);
  const dry = authoriseSweep({
    requested: "dry-run",
    executionEnabled: false,
    liabilityAuthorised: false,
    approval: null,
    plan,
    parent: "trest",
    signer: DEPLOYER,
    destination: DESTINATION,
  });
  assert.equal(dry.ok, true);
  const settled = settleSweep("confirmed");
  assert.equal(settled.complete, true);
  assert.equal(settled.liabilities, "unfunded");
  assert.equal(settleSweep("uncertain").liabilities, "unresolved");
  assert.equal(settleSweep("failed").complete, false);
  const disabled = openSweep({ requested: "execute", executionEnabled: false, liabilityAuthorised: false, approval: "a".repeat(32), plan: clear });
  assert.equal(disabled.broadcast, false);
  assert.equal(disabled.code, "execution_disabled");
  const liable = openSweep({ requested: "execute", executionEnabled: true, liabilityAuthorised: false, approval: "a".repeat(32), plan });
  assert.equal(liable.broadcast, false);
  assert.equal(liable.fence, false);
  assert.equal(liable.code, "holder_liability_unauthorised");
  const armed = openSweep({ requested: "execute", executionEnabled: true, liabilityAuthorised: false, approval: "a".repeat(32), plan: clear });
  assert.equal(armed.broadcast, true);
  assert.equal(armed.fence, true);
  assert.equal(armed.audit.status, "submitted");
  const planned = openSweep({ requested: "dry-run", executionEnabled: false, liabilityAuthorised: false, approval: null, plan });
  assert.equal(planned.broadcast, false);
  assert.equal(planned.audit.status, "planned");
});

test("confirmed child fees require shareholder receipts for every locked category", () => {
  const categories = [
    {
      category: "community_split" as const,
      originator: HOLDER,
      observed: [
        { address: LAUNCHER, shareBps: 6000 },
        { address: HOLDER, shareBps: 2500 },
        { address: PLATFORM_FEE_WALLET, shareBps: 1500 },
      ],
      deltas: [
        { owner: DEPLOYER, mint: TREST, amount: "10000", sign: "debit" as const },
        { owner: LAUNCHER, mint: TREST, amount: "6000", sign: "credit" as const },
        { owner: HOLDER, mint: TREST, amount: "2500", sign: "credit" as const },
        { owner: PLATFORM_FEE_WALLET, mint: TREST, amount: "1500", sign: "credit" as const },
      ],
    },
    {
      category: "originator_launch" as const,
      originator: null,
      observed: [
        { address: LAUNCHER, shareBps: 8500 },
        { address: PLATFORM_FEE_WALLET, shareBps: 1500 },
      ],
      deltas: [
        { owner: DEPLOYER, mint: TREST, amount: "10000", sign: "debit" as const },
        { owner: LAUNCHER, mint: TREST, amount: "8500", sign: "credit" as const },
        { owner: PLATFORM_FEE_WALLET, mint: TREST, amount: "1500", sign: "credit" as const },
      ],
    },
    {
      category: "official" as const,
      originator: null,
      observed: [
        { address: LAUNCHER, shareBps: 6000 },
        { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
      ],
      deltas: [
        { owner: DEPLOYER, mint: TREST, amount: "10000", sign: "debit" as const },
        { owner: LAUNCHER, mint: TREST, amount: "6000", sign: "credit" as const },
        { owner: PLATFORM_FEE_WALLET, mint: TREST, amount: "4000", sign: "credit" as const },
      ],
    },
  ];
  for (const row of categories) {
    const sharing = verifyChildSharing({
      category: row.category,
      launcherWallet: LAUNCHER,
      originatorWallet: row.originator,
      observed: row.observed,
      adminRevoked: true,
    });
    assert.equal(sharing.ok, true);
    if (!sharing.ok) return;
    const matched = matchShareholderReceipts({ quoteMint: TREST, shareholders: sharing.shareholders, distributed: "10000", deltas: row.deltas });
    assert.equal(matched.ok, true);
    const builtOnly = matchShareholderReceipts({ quoteMint: TREST, shareholders: sharing.shareholders, distributed: "10000", deltas: [] });
    assert.equal(builtOnly.ok, false);
  }
});

test("the finalized VENT distribution matches Pump's independent floor and rejects a one-unit drift", () => {
  const quote = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
  const launcher = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";
  const platform = PLATFORM_FEE_WALLET;
  const vault = "9NXoqw9svrX4kD3bRkxQuyV5bkxeQugLgkJr2z5EnXjw";
  const shareholders = [
    { address: launcher, shareBps: 6000 },
    { address: platform, shareBps: 4000 },
  ];
  const deltas = [
    { owner: vault, mint: quote, amount: "135936184193", sign: "debit" as const },
    { owner: launcher, mint: quote, amount: "81561710516", sign: "credit" as const },
    { owner: platform, mint: quote, amount: "54374473677", sign: "credit" as const },
  ];
  const matched = matchShareholderReceipts({ quoteMint: quote, shareholders, distributed: "135936184193", deltas });
  assert.equal(matched.ok, true);
  if (!matched.ok) return;
  assert.deepEqual(matched.receipts, [
    { address: launcher, amount: "81561710516" },
    { address: platform, amount: "54374473677" },
  ]);
  const drifted = deltas.map((row) => {
    if (row.owner === launcher) return { ...row, amount: "81561710517" };
    if (row.owner === platform) return { ...row, amount: "54374473676" };
    return row;
  });
  assert.equal(matchShareholderReceipts({ quoteMint: quote, shareholders, distributed: "135936184193", deltas: drifted }).ok, false);
  const extra = [...deltas, { owner: vault, mint: quote, amount: "1", sign: "credit" as const }];
  assert.equal(matchShareholderReceipts({ quoteMint: quote, shareholders, distributed: "135936184193", deltas: extra }).ok, false);
  const wrongMint = deltas.map((row) => ({ ...row, mint: TREST }));
  assert.equal(matchShareholderReceipts({ quoteMint: quote, shareholders, distributed: "135936184193", deltas: wrongMint }).ok, false);
});

test("account presentation keeps pending payouts, paid history, and child earnings apart", () => {
  const view = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "40", windowKey: "w1" }],
    claims: [
      { asset: "sol", amount: "20", status: "uncertain", signature: "pending-signature" },
      { asset: "trest", amount: "10", status: "confirmed", signature: "paid-signature" },
    ],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [{ role: "launcher", scope: "production", mint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa", amount: "9", signature: null }],
  });
  assert.equal(view.eligible, true);
  assert.equal(view.claimableSol, "80");
  assert.equal(view.claimableToken, "30");
  assert.equal(view.pendingSol, "20");
  assert.equal(view.paidToken, "10");
  assert.equal(view.activity.some((item) => item.status === "uncertain"), true);
  assert.equal(view.activity.some((item) => item.status === "paid"), true);
  assert.equal(view.execution, "reconciling");
  assert.equal(view.executionReason.includes("not authorised"), false);
  const solOnly = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "0", windowKey: "w1" }],
    claims: [],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.deepEqual(claimAllPlan(solOnly), ["sol"]);
  assert.equal(solOnly.executionReason, "SOL is ready to claim.");
  const confirmed = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "0", windowKey: "w1" }],
    claims: [{ asset: "sol", amount: "100", status: "confirmed", signature: "paid" }],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.equal(confirmed.execution, "confirmed");
  assert.equal(confirmed.claimableSol, "0");
  assert.equal(claimAllPlan(confirmed).length, 0);
  assert.equal(claimAllResults([{ asset: "sol", ok: true, code: "confirmed" }]).outcome, "confirmed");
  const suspended = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "suspended",
    snapshots: [],
    claims: [],
    windows: [],
    wallet: HOLDER,
    threshold: null,
    currentBalance: null,
    earnings: [],
  });
  assert.equal(suspended.execution, "suspended");
  assert.equal(suspended.executionReason.includes("not authorised"), false);
  const none = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [],
    claims: [],
    windows: [],
    wallet: HOLDER,
    threshold: null,
    currentBalance: null,
    earnings: [],
  });
  assert.equal(none.execution, "empty");
  assert.equal(claimAllPlan(none).length, 0);
  const tokenOnly = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "0", tokenAmount: "40", windowKey: "w1" }],
    claims: [],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.deepEqual(claimAllPlan(tokenOnly), ["parent_token"]);
  assert.equal(tokenOnly.executionReason, "Parent-token rewards are ready to claim.");
  const both = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "40", windowKey: "w1" }],
    claims: [],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.deepEqual(claimAllPlan(both), ["sol", "parent_token"]);
  const pending = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "0", windowKey: "w1" }],
    claims: [{ asset: "sol", amount: "100", status: "submitted", signature: "submitted-signature" }],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.equal(pending.execution, "confirming");
  assert.equal(pending.claimableSol, "0");
  const failed = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "ready",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "0", windowKey: "w1" }],
    claims: [{ asset: "sol", amount: "100", status: "failed", signature: "failed-signature" }],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.equal(failed.execution, "ready");
  assert.equal(failed.claimableSol, "100");
  const unknown = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "unknown",
    snapshots: [{ owner: HOLDER, balance: "50000000000", solLamports: "100", tokenAmount: "0", windowKey: "w1" }],
    claims: [],
    windows: [{ windowKey: "w1" }],
    wallet: HOLDER,
    threshold: "50000000000",
    currentBalance: null,
    earnings: [],
  });
  assert.equal(unknown.execution, "unreadable");
  assert.equal(unknown.executionReason.includes("not authorised"), false);
  assert.equal(claimAllResults([{ asset: "sol", ok: false, code: "awaiting reconciliation" }]).outcome, "failed");
  assert.equal(view.earnings.length, 0);
  assert.equal(view.currentBalance, null);
  const buttons = readFileSync(new URL("../../components/account/claim-actions.tsx", import.meta.url), "utf8");
  assert.equal(buttons.includes("max-[561px]:w-full"), true);
  assert.equal(buttons.includes("Claim SOL"), true);
  assert.equal(buttons.includes("Claim Tokens"), true);
  assert.equal(buttons.includes("Claim All"), true);
});

test("fixture evidence cannot pass a financial launch gate", () => {
  assert.equal(financialGate({ fixture: true, readOnlyMainnet: false, signed: false, confirmed: false }), "BLOCKED");
  assert.equal(financialGate({ fixture: true, readOnlyMainnet: true, signed: false, confirmed: false }), "PARTIAL");
  assert.equal(infrastructureGate({ servicesHealthy: true, schemaCurrent: false, recoveryTested: false }), "PARTIAL");
  assert.equal(new PublicKey(DESTINATION).toBase58(), DESTINATION);
});
