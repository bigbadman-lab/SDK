import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { quoteDeltaRows } from "./child-distribution.ts";
import { serviceChildFees } from "./child-fees.ts";
import { cliMain } from "./kill-wallet.ts";

function address(): string {
  return new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
}

function secret(): string {
  return bs58.encode(nacl.sign.keyPair().secretKey);
}

const DESTINATION = address();
const SIGNER = address();

test("kill-wallet dry-run refuses the wrong parent, destination argument, and missing approval", async () => {
  const missing = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--dry-run"], {});
  assert.equal(missing.out, "destination_unconfigured");
  const argument = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--destination", DESTINATION], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
  });
  assert.equal(argument.out, "destination_argument");
  const wrongParent = await cliMain(["node", "kill-wallet.ts", "--parent", "sdk", "--dry-run"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
  });
  assert.equal(wrongParent.out, "parent_rejected");
  const mismatched = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--execute"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
    TREST_DEPLOYER_PRIVATE_KEY: secret(),
  });
  assert.equal(mismatched.out, "signer_mismatch");
  const dry = await cliMain(["node", "kill-wallet.ts", "--parent", "trest"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
    TREST_SIGNER_SUSPENDED: "true",
  }, {
    solBalance: "20000000",
    rentMinimum: "890880",
    tokenBalance: "10",
    liabilities: {
      claimableSol: "1",
      claimableToken: "2",
      deployerRetained: "3",
      unspentBuyback: "4",
      unallocated: "5",
    },
    inFlightClaim: true,
    inFlightBuyback: true,
  });
  assert.equal(dry.code, 0);
  assert.match(dry.out, /^mode=dry-run/m);
  assert.match(dry.out, new RegExp(`destination=${DESTINATION}`));
  assert.match(dry.out, /shortfall=true/);
  assert.match(dry.out, /suspended=true/);
  assert.match(dry.out, /custody=deployer_wallet/);
  const executed = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--execute"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
    KILL_WALLET_APPROVAL: "b".repeat(32),
  });
  assert.equal(executed.code, 3);
  assert.match(executed.out, /mode=execution_disabled/);
});

test("child fee servicing does not submit a native collection or a suspended pass", async () => {
  let submitted = 0;
  const suspended = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 1, 0),
    authorised: true,
    suspended: true,
    emergencyFence: false,
    children: [],
    completedKeys: [],
    readConfig: async () => null,
    prepare: async () => null,
    submit: async () => {
      submitted += 1;
      return { status: "confirmed", receipts: [{ address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", amount: "1" }] };
    },
  });
  assert.equal(suspended.ok, false);
  const native = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 1, 0),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [{
      mint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse",
      quoteMint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
      scope: "test",
      category: "official",
      launcher: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      originator: null,
    }],
    completedKeys: [],
    readConfig: async () => ({
      adminRevoked: true,
      shareholders: [
        { address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", shareBps: 6000 },
        { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 4000 },
      ],
    }),
    prepare: async () => [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: [207, 17, 138, 242, 4, 34, 19, 56], keys: [] }],
    submit: async () => {
      submitted += 1;
      return { status: "confirmed", receipts: [{ address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", amount: "1" }] };
    },
  });
  assert.equal(native.ok, true);
  if (!native.ok) return;
  assert.equal(native.submitted, 0);
  assert.equal(submitted, 0);
  const once = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 1, 0),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [{
      mint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse",
      quoteMint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
      scope: "test",
      category: "official",
      launcher: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      originator: null,
    }],
    completedKeys: [],
    readConfig: async () => ({
      adminRevoked: true,
      shareholders: [
        { address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", shareBps: 6000 },
        { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 4000 },
      ],
    }),
    prepare: async () => [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: [255, 203, 19, 79, 244, 68, 8, 159], keys: [] }],
    submit: async () => {
      submitted += 1;
      return { status: "confirmed", receipts: [{ address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", amount: "1" }] };
    },
  });
  assert.equal(once.ok, true);
  if (!once.ok) return;
  assert.equal(once.submitted, 1);
  const duplicate = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 1, 0),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [{
      mint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse",
      quoteMint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
      scope: "test",
      category: "official",
      launcher: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      originator: null,
    }],
    completedKeys: [`child:test:GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse:${Date.UTC(2026, 9, 20, 16, 0, 0)}`],
    readConfig: async () => null,
    prepare: async () => null,
    submit: async () => {
      submitted += 1;
      return { status: "confirmed", receipts: [{ address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", amount: "1" }] };
    },
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.submitted, 0);
  assert.equal(submitted, 1);
});

test("a child distribution without shareholder receipts is not counted as submitted", async () => {
  const empty = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 1, 0),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [{
      mint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse",
      quoteMint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
      scope: "test",
      category: "official",
      launcher: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      originator: null,
    }],
    completedKeys: [],
    readConfig: async () => ({
      adminRevoked: true,
      shareholders: [
        { address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", shareBps: 6000 },
        { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 4000 },
      ],
    }),
    prepare: async () => [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: [255, 203, 19, 79, 244, 68, 8, 159], keys: [] }],
    submit: async () => ({ status: "confirmed", receipts: [] }),
  });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.equal(empty.verified, 1);
  assert.equal(empty.submitted, 0);
  const unresolved = await serviceChildFees({
    nowMs: Date.UTC(2026, 9, 20, 16, 6, 0),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [{
      mint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse",
      quoteMint: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
      scope: "test",
      category: "official",
      launcher: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      originator: null,
    }],
    completedKeys: [],
    readConfig: async () => ({
      adminRevoked: true,
      shareholders: [
        { address: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", shareBps: 6000 },
        { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 4000 },
      ],
    }),
    prepare: async () => [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: [255, 203, 19, 79, 244, 68, 8, 159], keys: [] }],
    submit: async () => ({ status: "unreconciled" }),
  });
  assert.equal(unresolved.ok, true);
  if (!unresolved.ok) return;
  assert.equal(unresolved.submitted, 0);
});

test("authorised kill-wallet fences and records before broadcast, and a shortfall stays blocked", async () => {
  const order: string[] = [];
  const io = {
    solBalance: "20000000",
    rentMinimum: "890880",
    tokenBalance: "10",
    record: async () => {
      order.push("record");
    },
    broadcast: async () => {
      order.push("broadcast");
      return "confirmed" as const;
    },
    fence: async () => {
      order.push("fence");
    },
  };
  const shortfall = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--execute"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
    KILL_WALLET_APPROVAL: "c".repeat(32),
    KILL_WALLET_EXECUTION_AUTHORIZED: "true",
  }, {
    ...io,
    liabilities: { claimableSol: "1", claimableToken: "0", deployerRetained: "0", unspentBuyback: "0", unallocated: "0" },
  });
  assert.equal(shortfall.code, 2);
  assert.match(shortfall.out, /mode=holder_liability_unauthorised/);
  assert.deepEqual(order, ["record"]);
  order.length = 0;
  const executed = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--execute"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
    KILL_WALLET_APPROVAL: "c".repeat(32),
    KILL_WALLET_EXECUTION_AUTHORIZED: "true",
  }, {
    ...io,
    liabilities: { claimableSol: "0", claimableToken: "0", deployerRetained: "0", unspentBuyback: "0", unallocated: "0" },
  });
  assert.equal(executed.code, 0);
  assert.match(executed.out, /mode=confirmed/);
  assert.deepEqual(order, ["fence", "record", "broadcast", "record", "fence"]);
  let broadcasts = 0;
  const unrecorded = await cliMain(["node", "kill-wallet.ts", "--parent", "trest", "--execute"], {
    KILL_WALLET: DESTINATION,
    TREST_DEPLOYER_ADDRESS: SIGNER,
    KILL_WALLET_APPROVAL: "c".repeat(32),
    KILL_WALLET_EXECUTION_AUTHORIZED: "true",
  }, {
    solBalance: "20000000",
    rentMinimum: "890880",
    tokenBalance: "10",
    liabilities: { claimableSol: "0", claimableToken: "0", deployerRetained: "0", unspentBuyback: "0", unallocated: "0" },
    broadcast: async () => {
      broadcasts += 1;
      return "confirmed";
    },
  });
  assert.equal(broadcasts, 0);
  assert.equal(unrecorded.code, 2);
  assert.match(unrecorded.out, /mode=record_failed/);
});

test("quote-token receipt deltas ignore a built instruction with no balance increase", () => {
  const mint = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
  const owner = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
  const row = { mint, owner, uiTokenAmount: { amount: "10" } };
  const vault = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
  assert.deepEqual(quoteDeltaRows(mint, [row, { mint, owner: vault, uiTokenAmount: { amount: "40" } }], [
    { ...row, uiTokenAmount: { amount: "25" } },
    { mint, owner: vault, uiTokenAmount: { amount: "25" } },
  ]), [
    { owner, mint, amount: "15", sign: "credit" },
    { owner: vault, mint, amount: "15", sign: "debit" },
  ]);
  assert.deepEqual(quoteDeltaRows(mint, [row], [row]), []);
});
