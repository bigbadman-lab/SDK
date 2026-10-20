import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bindMint,
  canReplaceMint,
  isUnresolved,
  markAwaitingWallet,
  markExpired,
  markInvalidated,
  markMintLost,
  markSigned,
  markWalletRejected,
  startAttempt,
} from "./attempt.ts";
import { describeLaunchReadiness } from "./readiness.ts";
import { signingPhaseCopy } from "./signing-phase.ts";

const wallet = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const mint = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const otherMint = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";

test("one unresolved launch keeps the same mint", () => {
  const started = startAttempt({
    existing: [],
    wallet,
    launchId: "launch-1",
    idempotencyKey: "key-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const bound = bindMint(started.attempt, mint);
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  const again = bindMint(bound.attempt, mint);
  assert.equal(again.ok && again.attempt.mintPublicKey, mint);
  const changed = bindMint(bound.attempt, otherMint);
  assert.equal(changed.ok, false);
  const duplicate = startAttempt({
    existing: [bound.attempt],
    wallet,
    launchId: "launch-2",
    idempotencyKey: "key-2",
  });
  assert.equal(duplicate.ok, false);
});

test("a reload without the mint key does not claim the same signature can be rebuilt", () => {
  const started = startAttempt({
    existing: [],
    wallet,
    launchId: "launch-1",
    idempotencyKey: "key-1",
  });
  if (!started.ok) return;
  const bound = bindMint(started.attempt, mint);
  if (!bound.ok) return;
  const lost = markMintLost(markAwaitingWallet(bound.attempt));
  assert.equal(lost.status, "mint_lost");
  assert.equal(canReplaceMint(lost), true);
  assert.equal(JSON.stringify(lost).includes("secret"), false);
});

test("a signed attempt is not a submission and blocks a new mint", () => {
  const started = startAttempt({
    existing: [],
    wallet,
    launchId: "launch-1",
    idempotencyKey: "key-1",
  });
  if (!started.ok) return;
  const bound = bindMint(started.attempt, mint);
  if (!bound.ok) return;
  const signed = markSigned(bound.attempt, "a".repeat(64));
  assert.equal(signed.status, "signed");
  assert.equal(isUnresolved(signed), true);
  assert.equal(canReplaceMint(signed), false);
  assert.equal(markExpired(signed).status, "signed");
  const rejected = markWalletRejected(markAwaitingWallet(bound.attempt));
  assert.equal(rejected.status, "wallet_rejected");
  assert.equal(canReplaceMint(rejected), true);
  assert.equal(markInvalidated(bound.attempt).messageHash, null);
});

test("readiness does not invent a network fee and never submits", () => {
  assert.deepEqual(describeLaunchReadiness({ buyAmount: "0", sdkBalanceBaseUnits: null, requiredSdkBaseUnits: null }), {
    sol: "unchecked",
    sdkBuy: "none",
    submits: false,
  });
  assert.equal(
    describeLaunchReadiness({ buyAmount: "1", sdkBalanceBaseUnits: "10", requiredSdkBaseUnits: "20" }).sdkBuy,
    "short",
  );
});

test("signing copy never claims the transaction was submitted", () => {
  for (const phase of ["unavailable", "ready_to_sign", "awaiting_wallet", "wallet_rejected", "signed", "expired", "invalidated", "service_unavailable"] as const) {
    assert.equal(signingPhaseCopy(phase).submits, false);
  }
  assert.match(signingPhaseCopy("signed").body, /not been submitted/);
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  assert.match(form, /phase="unavailable"/);
  assert.match(form, /disabled/);
  assert.equal(form.includes("sendTransaction"), false);
  assert.equal(form.includes("/api/launch/build"), false);
});
