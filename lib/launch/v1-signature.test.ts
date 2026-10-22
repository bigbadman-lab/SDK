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
  type Address,
} from "@solana/kit";

import { finishLaunchSignatures, verifySignedCommitment } from "./v1-signature.ts";

const BLOCKHASH = "11111111111111111111111111111111";
const OTHER_HASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function transaction(input: {
  wallet: CryptoKeyPair;
  mint: CryptoKeyPair;
  blockhash?: string;
  data?: Uint8Array;
  feeAccount?: Address;
  extraProgram?: Address;
}) {
  const walletAddress = await getAddressFromPublicKey(input.wallet.publicKey);
  const mintAddress = await getAddressFromPublicKey(input.mint.publicKey);
  const drafted = pipe(
    createTransactionMessage({ version: 1 }),
    (current) => setTransactionMessageFeePayer(walletAddress, current),
    (current) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: (input.blockhash ?? BLOCKHASH) as never, lastValidBlockHeight: BigInt(100) },
        current,
      ),
    (current) =>
      appendTransactionMessageInstruction(
        {
          programAddress: address("11111111111111111111111111111111"),
          accounts: [
            { address: walletAddress, role: AccountRole.WRITABLE_SIGNER },
            { address: mintAddress, role: AccountRole.WRITABLE_SIGNER },
            { address: input.feeAccount ?? address("DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC"), role: AccountRole.WRITABLE },
          ],
          data: input.data ?? Uint8Array.of(1, 2, 3),
        },
        current,
      ),
  );
  const message = input.extraProgram
    ? appendTransactionMessageInstruction(
        {
          programAddress: input.extraProgram,
          accounts: [],
          data: Uint8Array.of(9),
        },
        drafted,
      )
    : drafted;
  const compiled = compileTransaction(message);
  const wire = Uint8Array.from(getTransactionEncoder().encode(compiled));
  const walletSigned = Uint8Array.from(
    getTransactionEncoder().encode(await partiallySignTransaction([input.wallet], compiled)),
  );
  return { wire, walletSigned, walletAddress, mintAddress, messageHash: await digest(Uint8Array.from(compiled.messageBytes)) };
}

test("a v1 launch signs wallet first and mint second", async () => {
  const wallet = await generateKeyPair();
  const mint = await generateKeyPair();
  const built = await transaction({ wallet, mint });
  const finished = await finishLaunchSignatures({
    committedTransaction: built.wire,
    walletSignedTransaction: built.walletSigned,
    mint,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
  });
  assert.equal(finished.ok, true);
  if (!finished.ok) return;
  assert.deepEqual(finished.signers, [built.walletAddress, built.mintAddress]);
  const verified = await verifySignedCommitment({
    transaction: finished.transaction,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
    metadataUri: "https://example.com/metadata.json",
    committedMetadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    committedBuyAmount: "0",
    shareholders: [{ address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 1500 }],
    committedShareholders: [{ address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 1500 }],
  });
  assert.equal(verified.ok, true);
});

test("blockhash, fee, metadata, buy, and mint changes are rejected", async () => {
  const wallet = await generateKeyPair();
  const mint = await generateKeyPair();
  const other = await generateKeyPair();
  const built = await transaction({ wallet, mint });
  const common = {
    committedTransaction: built.wire,
    mint,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
  };
  const changedHash = await transaction({ wallet, mint, blockhash: OTHER_HASH });
  const blockhash = await finishLaunchSignatures({ ...common, walletSignedTransaction: changedHash.walletSigned });
  assert.equal(blockhash.ok, false);
  if (blockhash.ok) return;
  assert.equal(blockhash.code, "blockhash_changed");
  const changedFee = await transaction({
    wallet,
    mint,
    feeAccount: address("AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa"),
  });
  const fee = await finishLaunchSignatures({ ...common, walletSignedTransaction: changedFee.walletSigned });
  assert.equal(fee.ok, false);
  if (fee.ok) return;
  assert.equal(fee.code, "message_changed");
  const changedData = await transaction({ wallet, mint, data: Uint8Array.of(9, 9, 9) });
  const metadata = await finishLaunchSignatures({ ...common, walletSignedTransaction: changedData.walletSigned });
  assert.equal(metadata.ok, false);
  if (metadata.ok) return;
  assert.equal(metadata.code, "message_changed");
  const expired = await finishLaunchSignatures({ ...common, walletSignedTransaction: built.walletSigned, now: 2_000 });
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.code, "expired");
  const wrongMint = await finishLaunchSignatures({ ...common, walletSignedTransaction: built.walletSigned, mint: other });
  assert.equal(wrongMint.ok, false);
  if (wrongMint.ok) return;
  assert.equal(wrongMint.code, "mint");
  const finished = await finishLaunchSignatures({ ...common, walletSignedTransaction: built.walletSigned });
  assert.equal(finished.ok, true);
  if (!finished.ok) return;
  const lineage = await verifySignedCommitment({
    transaction: finished.transaction,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
    metadataUri: "https://example.com/other.json",
    committedMetadataUri: "https://example.com/metadata.json",
    buyAmount: "1",
    committedBuyAmount: "0",
    shareholders: [{ address: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa", shareBps: 10000 }],
    committedShareholders: [{ address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 1500 }],
  });
  assert.equal(lineage.ok, false);
});

test("Phantom's lighthouse instruction can be co-signed and another program cannot", async () => {
  const wallet = await generateKeyPair();
  const mint = await generateKeyPair();
  const built = await transaction({ wallet, mint });
  const lighthouse = address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
  const augmented = await transaction({ wallet, mint, extraProgram: lighthouse });
  const common = {
    committedTransaction: built.wire,
    mint,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
  };
  const finished = await finishLaunchSignatures({ ...common, walletSignedTransaction: augmented.walletSigned });
  assert.equal(finished.ok, true);
  if (!finished.ok) return;
  const verified = await verifySignedCommitment({
    transaction: finished.transaction,
    committedTransaction: built.wire,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
    metadataUri: "https://example.com/metadata.json",
    committedMetadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    committedBuyAmount: "0",
    shareholders: [],
    committedShareholders: [],
  });
  assert.equal(verified.ok, true);
  const missingCommitment = await verifySignedCommitment({
    transaction: finished.transaction,
    walletAddress: built.walletAddress,
    mintAddress: built.mintAddress,
    messageHash: built.messageHash,
    blockhash: BLOCKHASH,
    expiresAt: 2_000,
    now: 1_000,
    metadataUri: "https://example.com/metadata.json",
    committedMetadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    committedBuyAmount: "0",
    shareholders: [],
    committedShareholders: [],
  });
  assert.equal(missingCommitment.ok, false);
  const other = await transaction({
    wallet,
    mint,
    extraProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });
  const rejected = await finishLaunchSignatures({ ...common, walletSignedTransaction: other.walletSigned });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, "message_changed");
});

test("signing files do not broadcast or carry a private key transport", () => {
  const files = [
    new URL("./v1-signature.ts", import.meta.url),
    new URL("../wallet/phantom-sign.ts", import.meta.url),
    new URL("../wallet/mint-keypair.ts", import.meta.url),
    new URL("../../app/api/launch/build/route.ts", import.meta.url),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("sendTransaction"), false);
    assert.equal(source.includes("sendAndConfirm"), false);
    assert.equal(/secretKey|privateKeyBytes/.test(source), false);
  }
});
