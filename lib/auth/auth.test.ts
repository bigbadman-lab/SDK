import { Keypair } from "@solana/web3.js";
import assert from "node:assert/strict";
import test from "node:test";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildSignInMessage,
  challengeDecision,
  sessionDecision,
  sessionMaxAgeSeconds,
  INACTIVITY_MS,
  SLIDE_AFTER_MS,
} from "./session.ts";
import { canonicalAddress, verifySolanaSignature } from "./solana.ts";
import { createNonce, createSessionToken, hashSessionToken } from "./token.ts";

test("canonical address rejects malformed input and normalizes a real key", () => {
  const address = Keypair.generate().publicKey.toBase58();
  assert.equal(canonicalAddress(address), address);
  assert.equal(canonicalAddress("not-a-wallet"), null);
  assert.equal(canonicalAddress(""), null);
});

test("server verifies the exact signed message and rejects tampering", () => {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const message = buildSignInMessage({
    domain: "localhost:3000",
    address,
    origin: "http://localhost:3000",
    network: "mainnet-beta",
    nonce: "nonce-1",
    issuedAt: "2026-10-18T12:00:00.000Z",
    expirationTime: "2026-10-18T12:05:00.000Z",
  });
  const signature = nacl.sign.detached(
    new TextEncoder().encode(message),
    keypair.secretKey,
  );
  assert.match(message, /Chain ID: mainnet\n/);
  assert.equal(message.includes("mainnet-beta"), false);
  const devnetMessage = buildSignInMessage({
    domain: "localhost:3000",
    address,
    origin: "http://localhost:3000",
    network: "devnet",
    nonce: "noncevalue1",
    issuedAt: "2026-10-18T12:00:00.000Z",
    expirationTime: "2026-10-18T12:05:00.000Z",
  });
  assert.match(devnetMessage, /Chain ID: devnet\n/);
  assert.equal(verifySolanaSignature(address, message, signature), true);
  assert.equal(
    verifySolanaSignature(address, `${message}\n`, signature),
    false,
  );
  const other = Keypair.generate().publicKey.toBase58();
  assert.equal(verifySolanaSignature(other, message, signature), false);
  const encoded = bs58.encode(signature);
  assert.equal(encoded.length > 0, true);
});

test("challenges reject expiry, reuse, domain, and network mismatches", () => {
  const base = {
    now: 1_000,
    expiresAt: 2_000,
    consumed: false,
    domain: "localhost:3000",
    expectedDomain: "localhost:3000",
    network: "mainnet-beta",
    expectedNetwork: "mainnet-beta",
  };
  assert.equal(challengeDecision(base), "ok");
  assert.equal(challengeDecision({ ...base, consumed: true }), "used");
  assert.equal(challengeDecision({ ...base, now: 2_000 }), "expired");
  assert.equal(
    challengeDecision({ ...base, expectedDomain: "sdk.example" }),
    "domain",
  );
  assert.equal(
    challengeDecision({ ...base, expectedNetwork: "devnet" }),
    "network",
  );
});

test("sessions expire on revocation, inactivity, and the absolute limit", () => {
  const now = 10_000_000;
  const active = {
    now,
    lastSeenAt: now - 1_000,
    absoluteExpiresAt: now + 1_000,
    revoked: false,
  };
  assert.equal(sessionDecision(active), "active");
  assert.equal(sessionDecision({ ...active, revoked: true }), "invalid");
  assert.equal(
    sessionDecision({ ...active, absoluteExpiresAt: now }),
    "invalid",
  );
  assert.equal(
    sessionDecision({ ...active, lastSeenAt: now - INACTIVITY_MS }),
    "invalid",
  );
  assert.equal(
    sessionDecision({ ...active, lastSeenAt: now - SLIDE_AFTER_MS }),
    "refresh",
  );
  assert.equal(sessionMaxAgeSeconds(now, now + 1_000), 1);
});

test("sign-in nonce is alphanumeric", () => {
  assert.match(createNonce(), /^[A-Za-z0-9]{8,}$/);
});

test("session token hash is not the raw token", () => {
  const token = createSessionToken();
  const hash = hashSessionToken(token, "test-secret");
  assert.notEqual(hash, token);
  assert.equal(hash, hashSessionToken(token, "test-secret"));
  assert.notEqual(hash, hashSessionToken(token, "other-secret"));
});
