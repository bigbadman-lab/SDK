import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { verifyLaunchEvidence } from "../../../lib/launch/chain-evidence.ts";
import { evidenceFromAccounts, loadLaunchEvidence, transactionFromRpc } from "./evidence.ts";
import { EXPECTED_PROGRAMS } from "./protocol.ts";

const require = createRequire(import.meta.url);
const BN = require("bn.js") as new (value: number) => unknown;
const { PumpSdk, feeSharingConfigPda } = require("@pump-fun/pump-sdk") as {
  PumpSdk: new () => {
    offlinePumpFeeProgram: { coder: { accounts: { encode(name: string, value: unknown): Promise<Buffer> } } };
    offlinePumpProgram: { coder: { accounts: { encode(name: string, value: unknown): Promise<Buffer> } } };
  };
  feeSharingConfigPda: (mint: PublicKey) => PublicKey;
};

const CHILD = new PublicKey("GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse");
const LAUNCHER = new PublicKey("EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1");
const PARENT = new PublicKey("AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa");
const PLATFORM = new PublicKey("DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC");
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const URI = "https://example.com/metadata.json";

function u64(value: number): unknown {
  return new BN(value);
}

async function encoded(creator: PublicKey = LAUNCHER) {
  const sdk = new PumpSdk();
  const sharing = await sdk.offlinePumpFeeProgram.coder.accounts.encode("sharingConfig", {
    bump: 1,
    version: 1,
    status: { active: {} },
    mint: CHILD,
    admin: LAUNCHER,
    adminRevoked: true,
    shareholders: [
      { address: LAUNCHER, shareBps: 8500 },
      { address: PLATFORM, shareBps: 1500 },
    ],
  });
  const curve = await sdk.offlinePumpProgram.coder.accounts.encode("bondingCurve", {
    virtualTokenReserves: u64(1),
    virtualQuoteReserves: u64(1),
    realTokenReserves: u64(1),
    realQuoteReserves: u64(1),
    tokenTotalSupply: u64(1),
    complete: false,
    creator,
    isMayhemMode: false,
    isCashbackCoin: false,
    quoteMint: PARENT,
    creatorFeeBps: u64(0),
    canEditCreatorFee: false,
    isHolderReward: false,
    creatorFee: u64(0),
    protocolFees: u64(0),
    depth: 1,
    initialVirtualQuoteReserves: u64(1),
    postCompleteBaseOut: u64(0),
    postCompleteQuoteIn: u64(0),
  });
  return { sharing, curve };
}

test("Pump account bytes decode fee shares, admin revocation, and the quote parent", async () => {
  const accounts = await encoded();
  const evidence = evidenceFromAccounts({
    childMint: CHILD.toBase58(),
    launcher: LAUNCHER.toBase58(),
    mintAccount: { owner: TOKEN, data: Uint8Array.of(1) },
    curveAccount: { owner: EXPECTED_PROGRAMS.pump, data: accounts.curve },
    sharingAccount: { owner: EXPECTED_PROGRAMS.fee, data: accounts.sharing },
    metadataAccount: { owner: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", data: Buffer.from(URI) },
    transaction: {
      status: "confirmed",
      error: false,
      slot: "44",
      preTokenBalances: [],
      postTokenBalances: [{ mint: CHILD.toBase58(), owner: LAUNCHER.toBase58(), amount: "1" }],
    },
  });
  const verdict = verifyLaunchEvidence(
    {
      childMint: CHILD.toBase58(),
      parentMint: PARENT.toBase58(),
      launcher: LAUNCHER.toBase58(),
      tokenProgram: TOKEN,
      metadataUri: URI,
      buyAmount: "1",
      shareholders: [
        { address: LAUNCHER.toBase58(), shareBps: 8500 },
        { address: PLATFORM.toBase58(), shareBps: 1500 },
      ],
    },
    evidence,
  );
  assert.equal(verdict.verified, true);
  const mismatch = verifyLaunchEvidence(
    {
      childMint: CHILD.toBase58(),
      parentMint: PARENT.toBase58(),
      launcher: LAUNCHER.toBase58(),
      tokenProgram: TOKEN,
      metadataUri: URI,
      buyAmount: "1",
      shareholders: [{ address: LAUNCHER.toBase58(), shareBps: 10000 }],
    },
    evidence,
  );
  assert.equal(mismatch.failed, true);
  assert.equal(mismatch.missing.includes("shareholders"), true);
  const revoked = evidenceFromAccounts({
    childMint: CHILD.toBase58(),
    launcher: LAUNCHER.toBase58(),
    mintAccount: { owner: TOKEN, data: Uint8Array.of(1) },
    curveAccount: { owner: EXPECTED_PROGRAMS.pump, data: accounts.curve },
    sharingAccount: null,
    metadataAccount: null,
    transaction: { status: "confirmed", error: false, slot: "44", preTokenBalances: [], postTokenBalances: [] },
  });
  const incomplete = verifyLaunchEvidence(
    {
      childMint: CHILD.toBase58(),
      parentMint: PARENT.toBase58(),
      launcher: LAUNCHER.toBase58(),
      tokenProgram: TOKEN,
      metadataUri: URI,
      buyAmount: "0",
      shareholders: [],
    },
    revoked,
  );
  assert.equal(incomplete.verified, false);
  assert.equal(incomplete.failed, false);
  const openAdmin = await encoded();
  const sdk = new PumpSdk();
  const stillAdmin = await sdk.offlinePumpFeeProgram.coder.accounts.encode("sharingConfig", {
    bump: 1,
    version: 1,
    status: { active: {} },
    mint: CHILD,
    admin: LAUNCHER,
    adminRevoked: false,
    shareholders: [
      { address: LAUNCHER, shareBps: 8500 },
      { address: PLATFORM, shareBps: 1500 },
    ],
  });
  const admin = evidenceFromAccounts({
    childMint: CHILD.toBase58(),
    launcher: LAUNCHER.toBase58(),
    mintAccount: { owner: TOKEN, data: Uint8Array.of(1) },
    curveAccount: { owner: EXPECTED_PROGRAMS.pump, data: openAdmin.curve },
    sharingAccount: { owner: EXPECTED_PROGRAMS.fee, data: stillAdmin },
    metadataAccount: { owner: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", data: Buffer.from(URI) },
    transaction: { status: "failed", error: true, slot: "44", preTokenBalances: [], postTokenBalances: [] },
  });
  assert.equal(admin.adminRevoked, false);
  assert.equal(verifyLaunchEvidence(
    {
      childMint: CHILD.toBase58(),
      parentMint: PARENT.toBase58(),
      launcher: LAUNCHER.toBase58(),
      tokenProgram: TOKEN,
      metadataUri: URI,
      buyAmount: "0",
      shareholders: [
        { address: LAUNCHER.toBase58(), shareBps: 8500 },
        { address: PLATFORM.toBase58(), shareBps: 1500 },
      ],
    },
    admin,
  ).failed, true);
});

test("a reader without accounts stays unverified", async () => {
  const evidence = await loadLaunchEvidence(
    {
      async account() {
        return null;
      },
      async transaction() {
        return null;
      },
    },
    { signature: "2".repeat(88), childMint: CHILD.toBase58(), launcher: LAUNCHER.toBase58() },
  );
  assert.equal(evidence.transactionStatus, "missing");
  assert.equal(evidence.shareholders, null);
  assert.equal(evidence.adminRevoked, null);
  const verdict = verifyLaunchEvidence(
    {
      childMint: CHILD.toBase58(),
      parentMint: PARENT.toBase58(),
      launcher: LAUNCHER.toBase58(),
      tokenProgram: TOKEN,
      metadataUri: URI,
      buyAmount: "0",
      shareholders: [],
    },
    evidence,
  );
  assert.equal(verdict.verified, false);
  assert.equal(verdict.failed, false);
});

test("a version 1 transaction is confirmed from its metadata", () => {
  const confirmed = transactionFromRpc({
    slot: 460107051,
    meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
  });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.error, false);
  assert.equal(confirmed.slot, "460107051");
  assert.equal(transactionFromRpc(null).status, "missing");
});

test("fee sharing migration still identifies the launcher and the mint metadata", async () => {
  const accounts = await encoded(feeSharingConfigPda(CHILD));
  const evidence = evidenceFromAccounts({
    childMint: CHILD.toBase58(),
    launcher: LAUNCHER.toBase58(),
    mintAccount: { owner: TOKEN, data: Buffer.from(`mint ${URI}`) },
    curveAccount: { owner: EXPECTED_PROGRAMS.pump, data: accounts.curve },
    sharingAccount: { owner: EXPECTED_PROGRAMS.fee, data: accounts.sharing },
    metadataAccount: null,
    transaction: {
      status: "confirmed",
      error: false,
      slot: "44",
      preTokenBalances: [],
      postTokenBalances: [],
    },
  });
  assert.equal(evidence.launcher, LAUNCHER.toBase58());
  assert.equal(evidence.metadataUri, URI);
  assert.equal(evidence.adminRevoked, true);
  assert.equal(
    verifyLaunchEvidence(
      {
        childMint: CHILD.toBase58(),
        parentMint: PARENT.toBase58(),
        launcher: LAUNCHER.toBase58(),
        tokenProgram: TOKEN,
        metadataUri: URI,
        buyAmount: "0",
        shareholders: [
          { address: LAUNCHER.toBase58(), shareBps: 8500 },
          { address: PLATFORM.toBase58(), shareBps: 1500 },
        ],
      },
      evidence,
    ).verified,
    true,
  );
});
