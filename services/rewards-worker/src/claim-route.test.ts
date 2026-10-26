import assert from "node:assert/strict";
import test from "node:test";

import { claimsRouteDecision, parseClaimBody, settleClaimHttp } from "./claim-route.ts";

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

test("the claim route rejects a production claim before execution and still accepts a test claim", async () => {
  let executed = 0;
  const execute = async () => {
    executed += 1;
    return { ok: true, signature: "signature" };
  };
  const production = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    raw: JSON.stringify({ ...claim, scope: "production" }),
    execute,
  });
  assert.equal(production.status, 409);
  assert.equal(production.body.code, "parent");
  assert.equal(executed, 0);
  const testClaim = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    raw: JSON.stringify(claim),
    execute,
  });
  assert.equal(testClaim.status, 200);
  assert.equal(executed, 1);
  const closed = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    productionReady: true,
    raw: JSON.stringify({ ...claim, scope: "production" }),
    execute: async () => ({ ok: false, code: "inactive" }),
  });
  assert.equal(closed.status, 503);
  assert.equal(closed.body.code, "inactive");
  const opened = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    productionReady: true,
    raw: JSON.stringify({ ...claim, scope: "production" }),
    execute,
  });
  assert.equal(opened.status, 200);
  assert.equal(executed, 2);
});
