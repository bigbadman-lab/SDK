import assert from "node:assert/strict";
import test from "node:test";

import { claimsRouteDecision, parseClaimBody } from "./claim-route.ts";

const claim = {
  scope: "test",
  parentMint: "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse",
  claimant: "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y",
  asset: "sol",
  amount: "10",
  idempotencyKey: "claim-sol-holder-0001",
  message: "sdk.fund/rewards/test",
  signature: "2".repeat(88),
  domain: "sdk.fund",
};

test("the claim route rejects unsigned callers, inactive runtimes, and instruction payloads", () => {
  assert.equal(claimsRouteDecision({ headerMatches: false, runtimeReady: true }).status, 401);
  assert.equal(claimsRouteDecision({ headerMatches: true, runtimeReady: false }).status, 503);
  assert.equal(claimsRouteDecision({ headerMatches: true, runtimeReady: true }).accept, true);
  assert.equal(parseClaimBody(JSON.stringify(claim)).ok, true);
  assert.equal(parseClaimBody(JSON.stringify({ ...claim, instructions: [] })).ok, false);
  assert.equal(parseClaimBody(JSON.stringify({ ...claim, transaction: "wire" })).ok, false);
  assert.equal(parseClaimBody(JSON.stringify({ ...claim, asset: "all" })).ok, false);
});
