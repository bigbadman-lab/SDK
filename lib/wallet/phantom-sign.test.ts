import assert from "node:assert/strict";
import test from "node:test";

import { readPhantomSigner, requestPhantomSignature, type PhantomSignInput } from "./phantom-sign.ts";

const address = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const transaction = Uint8Array.of(1, 2, 3, 4);

function phantom(sign?: PhantomSignInput["signTransaction"]): PhantomSignInput {
  return {
    name: "Phantom",
    accounts: [{ address }],
    signTransactionVersions: ["legacy", 0, 1],
    ...(sign ? { signTransaction: sign } : {}),
  };
}

test("a matching Phantom session can sign without a broadcast method", async () => {
  let called = false;
  const result = await requestPhantomSignature({
    sessionAddress: address,
    connectedAddress: address,
    wallets: [
      phantom(async (bytes, account) => {
        called = true;
        assert.equal(account, address);
        assert.deepEqual(bytes, transaction);
        return Uint8Array.of(9, 9);
      }),
    ],
    transaction,
  });
  assert.equal(called, true);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.signedTransaction, Uint8Array.of(9, 9));
});

test("unsupported versions, other wallets, and account changes do not sign", async () => {
  const legacy: PhantomSignInput = { ...phantom(), signTransactionVersions: ["legacy", 0] };
  assert.equal(
    (await requestPhantomSignature({
      sessionAddress: address,
      connectedAddress: address,
      wallets: [legacy],
      transaction,
    })).ok,
    false,
  );
  const other: PhantomSignInput = { ...phantom(async () => transaction), name: "Backpack" };
  const unsupported = await requestPhantomSignature({
    sessionAddress: address,
    connectedAddress: address,
    wallets: [other],
    transaction,
  });
  assert.equal(unsupported.ok, false);
  if (unsupported.ok) return;
  assert.equal(unsupported.code, "unsupported_wallet");
  const changed = await requestPhantomSignature({
    sessionAddress: address,
    connectedAddress: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
    wallets: [phantom(async () => transaction)],
    transaction,
  });
  assert.equal(changed.ok, false);
  if (changed.ok) return;
  assert.equal(changed.code, "wallet_session_invalid");
  const expired = await requestPhantomSignature({
    sessionAddress: null,
    connectedAddress: address,
    wallets: [phantom(async () => transaction)],
    transaction,
  });
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.code, "wallet_session_invalid");
  const missing: PhantomSignInput = { ...phantom(), signTransactionVersions: null };
  const feature = await requestPhantomSignature({
    sessionAddress: address,
    connectedAddress: address,
    wallets: [missing],
    transaction,
  });
  assert.equal(feature.ok, false);
  if (feature.ok) return;
  assert.equal(feature.code, "wallet_feature_unavailable");
});

test("the Wallet Standard feature receives the exact unsigned transaction", async () => {
  let seen: Uint8Array | null = null;
  const signer = readPhantomSigner({
    name: "Phantom",
    accounts: [{ address }],
    features: {
      "solana:signTransaction": {
        supportedTransactionVersions: ["legacy", 0, 1],
        signTransaction: async (inputs: readonly { account: { address: string }; transaction: Uint8Array }[]) => {
          const first = inputs[0];
          if (!first) throw new Error("missing");
          seen = first.transaction;
          assert.equal(first.account.address, address);
          return [{ signedTransaction: Uint8Array.of(7) }];
        },
      },
    },
  });
  const result = await requestPhantomSignature({
    sessionAddress: address,
    connectedAddress: address,
    wallets: [signer],
    transaction,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, transaction);
});

test("a Phantom rejection is not treated as a network failure", async () => {
  const result = await requestPhantomSignature({
    sessionAddress: address,
    connectedAddress: address,
    wallets: [
      phantom(async () => {
        throw new Error("User rejected the request");
      }),
    ],
    transaction,
  });
  assert.deepEqual(result, { ok: false, code: "sign_rejected" });
});
