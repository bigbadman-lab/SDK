import { Keypair } from "@solana/web3.js";
import assert from "node:assert/strict";
import test from "node:test";
import nacl from "tweetnacl";

import { verifySolanaSignature } from "./solana.ts";
import {
  describeSignFailure,
  encodeSignInMessage,
  normalizeWalletSignature,
  signingAccountMatches,
} from "./sign-message.ts";

test("the encoded challenge is the exact message the server verifies", () => {
  const keypair = Keypair.generate();
  const message = "localhost:3000 wants you to sign in with your Solana account:\nexact";
  const bytes = encodeSignInMessage(message);
  const signature = nacl.sign.detached(bytes, keypair.secretKey);
  assert.equal(
    verifySolanaSignature(keypair.publicKey.toBase58(), message, signature),
    true,
  );
  assert.deepEqual(Array.from(bytes), Array.from(new TextEncoder().encode(message)));
});

test("signature normalization accepts wallet byte and base58 forms", () => {
  const keypair = Keypair.generate();
  const signature = nacl.sign.detached(
    encodeSignInMessage("message"),
    keypair.secretKey,
  );
  assert.equal(normalizeWalletSignature(signature)?.byteLength, 64);
  assert.equal(
    normalizeWalletSignature({ signature })?.byteLength,
    64,
  );
  assert.equal(normalizeWalletSignature(signature.slice(0, 32)), null);
  assert.equal(normalizeWalletSignature({ signature: "not-a-signature" }), null);
});

test("the signing account must be the address in the challenge", () => {
  const shown = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  assert.equal(signingAccountMatches(shown, shown), true);
  assert.equal(signingAccountMatches(shown, other), false);
  assert.equal(signingAccountMatches(shown, null), false);
});

test("sign failures distinguish rejection, unsupported signing, and a missing account", () => {
  assert.equal(
    describeSignFailure({ name: "UserRejectedRequestError", message: "User rejected the request", code: 4001 }),
    "rejected",
  );
  assert.equal(
    describeSignFailure({ name: "WalletStandardFeatureNotSupportedError", message: "solana:signMessage" }),
    "unsupported",
  );
  assert.equal(
    describeSignFailure({ name: "WalletAccountError", message: "Account not found" }),
    "disconnected",
  );
  assert.equal(
    describeSignFailure(new TypeError("Cannot read private member from an object whose class did not declare it")),
    "failed",
  );
});

test("a proxied wallet provider cannot read private fields, and the raw provider can", async () => {
  class WalletSigner {
    #ready = true;

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
      if (!this.#ready) throw new Error("missing");
      return message;
    }
  }

  const raw = new WalletSigner();
  const proxied = new Proxy(raw, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(receiver) : value;
    },
  });
  const message = encodeSignInMessage("exact challenge");

  await assert.rejects(
    () => proxied.signMessage(message),
    /private member/,
  );
  assert.deepEqual(Array.from(await raw.signMessage(message)), Array.from(message));
});
