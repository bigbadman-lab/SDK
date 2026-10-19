import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "../../../lib/launch/fees.ts";
import { assembleChildLaunch, fixtureCurve, serializeMessage } from "./assemble.ts";
import { SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assessParent } from "./chain.ts";
import {
  FIXTURE_BLOCKHASH,
  FIXTURE_LAUNCHER,
  FIXTURE_MINT,
  FIXTURE_ORIGINATOR,
  FIXTURE_PARENT,
  measureFixtures,
} from "./fixtures.ts";
import { EXPECTED_PROGRAMS, pump } from "./protocol.ts";

test("packet bytes match the Solana serializer", () => {
  const payer = FIXTURE_LAUNCHER;
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: FIXTURE_BLOCKHASH,
    instructions: [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: FIXTURE_ORIGINATOR, lamports: 1 }),
    ],
  }).compileToV0Message();
  const official = new VersionedTransaction(message).serialize();
  const messageBytes = serializeMessage(message);
  assert.equal(Buffer.from(message.serialize()).equals(Buffer.from(messageBytes)), true);
  assert.equal(official.length, 1 + 64 + messageBytes.length);
});

test("pinned Pump program ids are the official addresses", () => {
  assert.equal(pump.PUMP_PROGRAM_ID.toBase58(), EXPECTED_PROGRAMS.pump);
  assert.equal(pump.PUMP_FEE_PROGRAM_ID.toBase58(), EXPECTED_PROGRAMS.fee);
  assert.equal(pump.PUMP_AMM_PROGRAM_ID.toBase58(), EXPECTED_PROGRAMS.amm);
  assert.equal(pump.QUOTE_CONTROL_PDA.toBase58(), EXPECTED_PROGRAMS.quoteControl);
});

test("a native or missing quote is rejected", async () => {
  const fees = allocateCreatorFees({
    category: "official",
    launcherWallet: FIXTURE_LAUNCHER.toBase58(),
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  assert.equal(fees.ok, true);
  if (!fees.ok) return;
  await assert.rejects(
    () => assembleChildLaunch({
      name: "Fixture",
      symbol: "FIX",
      uri: "https://example.com/metadata.json",
      mint: FIXTURE_MINT,
      launcher: FIXTURE_LAUNCHER,
      parentMint: NATIVE_MINT,
      quoteTokenProgram: NATIVE_MINT,
      shareholders: fees.shareholders,
      blockhash: FIXTURE_BLOCKHASH,
      lastValidBlockHeight: 1n,
      coverage: "fixture",
      buy: null,
    }),
    /quote/,
  );
});

test("fixture launches keep fee locking before an optional buy", async () => {
  const { staticMembers, measured, signers, worst } = await measureFixtures();
  assert.equal(staticMembers.includes(FIXTURE_MINT.toBase58()), false);
  assert.equal(staticMembers.includes(FIXTURE_LAUNCHER.toBase58()), false);
  assert.equal(staticMembers.includes(FIXTURE_PARENT.toBase58()), false);
  assert.equal(staticMembers.includes(PLATFORM_FEE_WALLET), true);
  for (const signer of signers) assert.equal(staticMembers.includes(signer), false);
  assert.equal(measured.length, 8);
  const standard = measured.filter((row) => !row.migrated);
  assert.equal(standard.length, 6);
  for (const row of measured) {
    assert.equal(row.coverage, "fixture");
    assert.equal(row.transactionVersion, 1);
    assert.equal(row.configMask, 15);
    assert.equal(row.roles[0], "create_v2");
    assert.equal(row.roles[1], "create_fee_sharing_config");
    assert.ok(row.roles.indexOf("update_fee_shares_v2") > row.roles.indexOf("quote_ata"));
    assert.equal(row.roles.includes("buy_exact_quote_in_v3"), row.buy);
    if (row.buy) assert.equal(row.roles.at(-1), "buy_exact_quote_in_v3");
    assert.equal(row.lookupTables, 0);
    assert.equal(row.signers, 2);
    assert.equal(row.fitsPacket, true);
    assert.ok(row.bytes <= 4096);
    assert.ok(row.accounts <= 64);
    assert.ok(row.staticAccountKeys.includes(FIXTURE_LAUNCHER.toBase58()));
    assert.ok(row.staticAccountKeys.includes(FIXTURE_MINT.toBase58()));
    assert.deepEqual([...row.signerAddresses].sort(), [...signers].sort());
  }
  assert.equal(worst.fitsPacket, true);
  assert.equal(worst.lookupTables, 0);
  assert.equal(worst.signers, 2);
  assert.ok(worst.bytes <= 4096);
  assert.ok(worst.accounts <= 64);
  console.log(JSON.stringify({
    standard: standard.map((row) => ({
      category: row.category,
      buy: row.buy,
      bytes: row.bytes,
      accounts: row.accounts,
      signers: row.signers,
    })),
    worst,
  }));
});

test("slippage is encoded as percent, not raw basis points", async () => {
  const fees = allocateCreatorFees({
    category: "official",
    launcherWallet: FIXTURE_LAUNCHER.toBase58(),
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  assert.equal(fees.ok, true);
  if (!fees.ok) return;
  const curve = fixtureCurve(FIXTURE_PARENT, FIXTURE_LAUNCHER);
  const common = {
    name: "Fixture",
    symbol: "FIX",
    uri: "https://example.com/metadata.json",
    mint: FIXTURE_MINT,
    launcher: FIXTURE_LAUNCHER,
    parentMint: FIXTURE_PARENT,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    shareholders: fees.shareholders,
    blockhash: FIXTURE_BLOCKHASH,
    lastValidBlockHeight: 1n,
    coverage: "fixture" as const,
    pumpQuote: { chain: [] },
  };
  const built = await assembleChildLaunch({
    ...common,
    buy: { quoteBaseUnits: new BN(1_000_000), tokenAmount: new BN(1_000_000), slippagePercent: 1, bondingCurve: curve },
  });
  const sdk = new pump.PumpSdk();
  const onePercent = await sdk.buyExactQuoteInV3Instructions({
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint: FIXTURE_MINT,
    user: FIXTURE_LAUNCHER,
    amount: new BN(1_000_000),
    quoteAmount: new BN(1_000_000),
    slippage: 1,
    tokenProgram: common.quoteTokenProgram,
    quoteTokenProgram: common.quoteTokenProgram,
  });
  const rawBps = await sdk.buyExactQuoteInV3Instructions({
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint: FIXTURE_MINT,
    user: FIXTURE_LAUNCHER,
    amount: new BN(1_000_000),
    quoteAmount: new BN(1_000_000),
    slippage: 100,
    tokenProgram: common.quoteTokenProgram,
    quoteTokenProgram: common.quoteTokenProgram,
  });
  const actual = built.instructions.at(-1);
  assert.ok(actual);
  const expected = onePercent.at(-1)?.data;
  const wrong = rawBps.at(-1)?.data;
  assert.ok(expected && wrong);
  assert.equal(Buffer.from(actual.data).equals(Buffer.from(expected)), true);
  assert.equal(Buffer.from(actual.data).equals(Buffer.from(wrong)), false);
  assert.throws(() => VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64")));
});

test("parent eligibility is pump-coin only", () => {
  const tokenProgram = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const base = {
    source: "pumpCoin",
    mayhem: false,
    cashback: false,
    parentDepth: 0,
    maxCurveDepth: 5,
    graduated: false,
    hasPool: false,
    decimals: 6,
    quoteTokenProgram: tokenProgram,
    registeredTokenProgram: null,
  };
  assert.equal(assessParent(base), "ok");
  assert.equal(assessParent({ ...base, source: "sol" }), "parent_ineligible");
  assert.equal(assessParent({ ...base, source: "global" }), "parent_ineligible");
  assert.equal(assessParent({ ...base, mayhem: true }), "parent_ineligible");
  assert.equal(assessParent({ ...base, parentDepth: 5 }), "parent_ineligible");
  assert.equal(assessParent({ ...base, maxCurveDepth: 0 }), "parent_ineligible");
  assert.equal(assessParent({ ...base, graduated: true, hasPool: false }), "parent_ineligible");
  assert.equal(assessParent({ ...base, registeredTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }), "parent_ineligible");
});

test("merged launcher and platform shareholders stay unique", async () => {
  const fees = allocateCreatorFees({
    category: "community_split",
    launcherWallet: PLATFORM_FEE_WALLET,
    originatorWallet: FIXTURE_ORIGINATOR.toBase58(),
    platformWallet: PLATFORM_FEE_WALLET,
  });
  assert.equal(fees.ok, true);
  if (!fees.ok) return;
  assert.equal(new Set(fees.shareholders.map((holder) => holder.address)).size, fees.shareholders.length);
  const assembled = await assembleChildLaunch({
    name: "Fixture",
    symbol: "FIX",
    uri: "https://example.com/metadata.json",
    mint: FIXTURE_MINT,
    launcher: new PublicKey(PLATFORM_FEE_WALLET),
    parentMint: FIXTURE_PARENT,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    shareholders: fees.shareholders,
    blockhash: FIXTURE_BLOCKHASH,
    lastValidBlockHeight: 1n,
    coverage: "fixture",
    buy: null,
  });
  assert.equal(assembled.staticAccountKeys.includes(PLATFORM_FEE_WALLET), true);
  assert.deepEqual(
    [...assembled.signers].sort(),
    [PLATFORM_FEE_WALLET, FIXTURE_MINT.toBase58()].sort(),
  );
  for (const instruction of assembled.instructions) {
    const role = assembled.roles[assembled.instructions.indexOf(instruction)];
    if (role !== "quote_ata") continue;
    const [payer, , owner] = instruction.keys;
    assert.equal(payer?.pubkey.toBase58(), PLATFORM_FEE_WALLET);
    assert.equal(payer?.isSigner, true);
    assert.equal(owner?.isSigner, false);
  }
  assert.equal(assembled.roles.includes("update_fee_shares_v2"), true);
  assert.equal(assembled.roles.includes("buy_exact_quote_in_v3"), false);
});
