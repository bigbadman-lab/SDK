import assert from "node:assert/strict";
import test from "node:test";

import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, collectionPlan } from "./collect.ts";
import {
  WINDOW_MS,
  acceptWindow,
  accountingWindow,
  authoriseBucketSpend,
  creditFee,
  creditedLamports,
  planIncrementalAllocation,
  recognizedReserveWithheld,
  retainedDeployerLamports,
  rewardBase,
  splitCreatorFees,
  splitHistoricalCreatorFees,
  type FeeReceipt,
} from "./ledger.ts";

const TREST = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const DEPLOYER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const DESTINATION = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SOL = "11111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";

function receipt(overrides: Partial<FeeReceipt> = {}): FeeReceipt {
  return {
    signature: "3".repeat(64),
    parentMint: TREST,
    scope: "test",
    amountLamports: "100",
    slot: "10",
    confirmed: true,
    source: "creator_vault",
    ...overrides,
  };
}

function spend(overrides: Partial<Parameters<typeof authoriseBucketSpend>[0]> = {}) {
  return authoriseBucketSpend({
    bucket: "holders",
    creditedLamports: "100",
    reserveLamports: "10",
    bucketSpentLamports: "0",
    amountLamports: "45",
    cycleSpentLamports: "0",
    cycleCapLamports: "45",
    slippageBps: 100,
    destination: DESTINATION,
    allowedDestinations: [DESTINATION],
    programs: [PUMP_PROGRAM_ID],
    allowedPrograms: [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, SYSTEM],
    suspended: false,
    walletLamports: "0",
    ...overrides,
  });
}

test("future creator fees split 50/50 and historical TREST fees stay 30/30/40", () => {
  assert.deepEqual(splitCreatorFees("100"), { ok: true, holders: "50", buyback: "0", deployer: "50" });
  assert.deepEqual(splitCreatorFees("10"), { ok: true, holders: "5", buyback: "0", deployer: "5" });
  assert.deepEqual(splitCreatorFees("3"), { ok: true, holders: "1", buyback: "0", deployer: "2" });
  assert.deepEqual(splitCreatorFees("1"), { ok: true, holders: "0", buyback: "0", deployer: "1" });
  assert.deepEqual(splitHistoricalCreatorFees("100"), { ok: true, holders: "30", buyback: "30", deployer: "40" });
  assert.deepEqual(splitHistoricalCreatorFees("10"), { ok: true, holders: "3", buyback: "3", deployer: "4" });
  assert.deepEqual(splitHistoricalCreatorFees("1"), { ok: true, holders: "0", buyback: "0", deployer: "1" });
  const window = accountingWindow(WINDOW_MS + 5);
  assert.deepEqual(window, { startMs: WINDOW_MS, endMs: WINDOW_MS * 2 });
});

test("only confirmed creator-vault receipts for the same parent are credited", () => {
  const first = creditFee([], receipt());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const duplicate = creditFee(first.receipts, receipt());
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.code, "duplicate");
  const unconfirmed = creditFee([], receipt({ confirmed: false }));
  assert.equal(unconfirmed.ok, false);
  if (unconfirmed.ok) return;
  assert.equal(unconfirmed.code, "unconfirmed");
  const deposit = creditFee([], receipt({ source: "wallet_deposit" }));
  assert.equal(deposit.ok, false);
  if (deposit.ok) return;
  assert.equal(deposit.code, "fee_source");
  const other = creditFee(first.receipts, receipt({ signature: "4".repeat(64), parentMint: SDK, scope: "production", amountLamports: "50" }));
  assert.equal(other.ok, true);
  if (!other.ok) return;
  assert.equal(creditedLamports(other.receipts, TREST, "test"), "100");
  assert.equal(creditedLamports(other.receipts, SDK, "production"), "50");
  assert.equal(creditedLamports(other.receipts, TREST, "production"), "0");
  const window = acceptWindow(["trest:1"], "trest:1");
  assert.equal(window.ok, false);
  if (window.ok) return;
  assert.equal(window.code, "duplicate");
});

test("spending stays inside the reserved bucket and ignores wallet deposits", () => {
  const base = rewardBase("100", "10");
  assert.deepEqual(base, { ok: true, base: "90" });
  assert.deepEqual(splitCreatorFees("90"), { ok: true, holders: "45", buyback: "0", deployer: "45" });
  assert.equal(spend().ok, true);
  const overBucket = spend({ amountLamports: "46" });
  const futureBuyback = spend({ bucket: "buyback", amountLamports: "1" });
  const walletDeposit = spend({ walletLamports: "999999999", creditedLamports: "0", amountLamports: "1" });
  const destination = spend({ destination: OTHER });
  const program = spend({ programs: [OTHER] });
  const suspended = spend({ suspended: true });
  const cycle = spend({ cycleSpentLamports: "40", amountLamports: "10", cycleCapLamports: "45" });
  const slippage = spend({ bucket: "buyback", slippageBps: 5000, amountLamports: "1" });
  assert.equal(overBucket.ok, false);
  assert.equal(walletDeposit.ok, false);
  assert.equal(destination.ok, false);
  assert.equal(program.ok, false);
  assert.equal(suspended.ok, false);
  assert.equal(cycle.ok, false);
  assert.equal(slippage.ok, false);
  if (overBucket.ok || futureBuyback.ok || walletDeposit.ok || destination.ok || program.ok || suspended.ok || cycle.ok || slippage.ok) return;
  assert.equal(overBucket.code, "unfunded");
  assert.equal(futureBuyback.code, "unfunded");
  assert.equal(walletDeposit.code, "unfunded");
  assert.equal(destination.code, "destination");
  assert.equal(program.code, "program");
  assert.equal(suspended.code, "suspended");
  assert.equal(cycle.code, "cycle");
  assert.equal(slippage.code, "slippage");
  const retained = retainedDeployerLamports("100", "10");
  assert.deepEqual(retained, { ok: true, retained: "45", spendable: "0" });
});

test("SOL single-recipient collection pays the creator and does not grant spending rights", () => {
  const plan = collectionPlan({ feeMode: "single_recipient", creator: DEPLOYER, quoteMint: SOL });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.pumpInstruction, "collectCreatorFeeV2");
  assert.equal(plan.pumpProgram, PUMP_PROGRAM_ID);
  assert.deepEqual(plan.discriminator, [207, 17, 138, 242, 4, 34, 19, 56]);
  assert.equal(plan.recipient, DEPLOYER);
  assert.equal(plan.crankSignerRequired, false);
  assert.equal(plan.proceedsAccount, "creator_system_account");
  assert.equal(plan.spendingSigner, "deployer");
  assert.equal(plan.ammLeg, "only_if_wsol_vault_exists");
  const sharing = collectionPlan({ feeMode: "fee_sharing", creator: DEPLOYER, quoteMint: SOL });
  assert.equal(sharing.ok, false);
  if (sharing.ok) return;
  assert.equal(sharing.path, "sweep_creator_fee_then_distribute_creator_fees");
  const holders = collectionPlan({ feeMode: "holder_rewards", creator: DEPLOYER, quoteMint: SOL });
  assert.equal(holders.ok, false);
  if (holders.ok) return;
  assert.equal(holders.path, "holder_rewards");
});

test("the historical standing reserve is recognised once", () => {
  const historical = recognizedReserveWithheld({
    reserveLamports: "5000000",
    allocated: [],
    recoveries: [{ signature: "historical", reserveWithheldLamports: "5000000" }],
  });
  assert.deepEqual(historical, { ok: true, withheld: "5000000" });
  const next = planIncrementalAllocation({
    grossLamports: "8753187",
    reserveLamports: "5000000",
    reserveWithheldLamports: historical.ok ? historical.withheld : "0",
  });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.withheld, "0");
  assert.equal(next.base, "8753187");
  assert.equal(next.holders, "4376593");
  assert.equal(next.buyback, "0");
  assert.equal(next.deployer, "4376594");
  const duplicate = recognizedReserveWithheld({
    reserveLamports: "5000000",
    allocated: [],
    recoveries: [
      { signature: "historical", reserveWithheldLamports: "5000000" },
      { signature: "historical", reserveWithheldLamports: "5000000" },
    ],
  });
  assert.deepEqual(duplicate, historical);
  const conflict = recognizedReserveWithheld({
    reserveLamports: "5000000",
    allocated: [],
    recoveries: [
      { signature: "historical", reserveWithheldLamports: "5000000" },
      { signature: "historical", reserveWithheldLamports: "1" },
    ],
  });
  assert.deepEqual(conflict, { ok: false, code: "amount" });
  const fresh = recognizedReserveWithheld({ reserveLamports: "5000000", allocated: [], recoveries: [] });
  const opening = planIncrementalAllocation({
    grossLamports: "100",
    reserveLamports: "5000000",
    reserveWithheldLamports: fresh.ok ? fresh.withheld : "1",
  });
  assert.equal(opening.ok, true);
  if (!opening.ok) return;
  assert.equal(opening.withheld, "100");
  assert.equal(opening.base, "0");
  const partial = recognizedReserveWithheld({
    reserveLamports: "5000000",
    allocated: [{ signature: "modern", reserveWithheldLamports: "2000000" }],
    recoveries: [],
  });
  const remainder = planIncrementalAllocation({
    grossLamports: "10000000",
    reserveLamports: "5000000",
    reserveWithheldLamports: partial.ok ? partial.withheld : "0",
  });
  assert.equal(remainder.ok, true);
  if (!remainder.ok) return;
  assert.equal(remainder.withheld, "3000000");
  assert.equal(remainder.holders, "3500000");
  assert.equal(remainder.buyback, "0");
  assert.equal(remainder.deployer, "3500000");
  const empty = planIncrementalAllocation({
    grossLamports: "0",
    reserveLamports: "5000000",
    reserveWithheldLamports: "5000000",
  });
  assert.deepEqual(empty, { ok: true, withheld: "0", base: "0", holders: "0", buyback: "0", deployer: "0" });
  const shared = recognizedReserveWithheld({
    reserveLamports: "5000000",
    allocated: [{ signature: "historical", reserveWithheldLamports: "5000000" }],
    recoveries: [{ signature: "historical", reserveWithheldLamports: "5000000" }],
  });
  assert.deepEqual(shared, { ok: true, withheld: "5000000" });
});
