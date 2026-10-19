import assert from "node:assert/strict";
import test from "node:test";

import { runBlueprint } from "../blueprint/execute.ts";
import { OFFICIAL_SDKS } from "../library/official.ts";
import {
  activeKeySlot,
  apiQuota,
  failureStatus,
  keyLookup,
  presentedKey,
  publicExecution,
  publishedVersionChoice,
} from "./contract.ts";

test("api keys are accepted only as a bearer secret", () => {
  assert.equal(presentedKey(null).ok, false);
  assert.equal(presentedKey("sdk_secret").ok, false);
  const secret = `sdk_${"a".repeat(43)}`;
  const parsed = presentedKey(`Bearer ${secret}`);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.secret, secret);
  assert.equal(keyLookup({ match: false, revoked: false }), "invalid_api_key");
  assert.equal(keyLookup({ match: true, revoked: true }), "revoked_api_key");
  assert.equal(keyLookup({ match: true, revoked: false }), "active");
});

test("five active keys is the account ceiling and a shared quota stops at 100", () => {
  assert.equal(activeKeySlot(4), "create");
  assert.equal(activeKeySlot(5), "reject");
  assert.equal(apiQuota(99).admit, true);
  assert.equal(apiQuota(99).remaining, 0);
  assert.deepEqual(apiQuota(100), { admit: false, remaining: 0 });
});

test("publication and version pinning ignore the caller blueprint", () => {
  assert.equal(publishedVersionChoice({
    found: false,
    published: false,
    requestedVersion: 1,
    availableVersions: [],
    currentVersion: null,
  }).ok, false);
  assert.deepEqual(
    publishedVersionChoice({
      found: true,
      published: false,
      requestedVersion: null,
      availableVersions: [1],
      currentVersion: 1,
    }),
    { ok: false, code: "sdk_unavailable" },
  );
  assert.deepEqual(
    publishedVersionChoice({
      found: true,
      published: true,
      requestedVersion: 2,
      availableVersions: [1],
      currentVersion: 1,
    }),
    { ok: false, code: "version_not_found" },
  );
  assert.deepEqual(
    publishedVersionChoice({
      found: true,
      published: true,
      requestedVersion: null,
      availableVersions: [1, 2],
      currentVersion: 2,
    }),
    { ok: true, version: 2 },
  );
  assert.deepEqual(
    publishedVersionChoice({
      found: true,
      published: true,
      requestedVersion: 1,
      availableVersions: [1, 2],
      currentVersion: 2,
    }),
    { ok: true, version: 1 },
  );
});

test("an official blueprint result becomes a public execution without traces", async () => {
  const sdk = OFFICIAL_SDKS[0];
  assert.ok(sdk);
  const started = new Date("2026-10-19T12:00:00.000Z");
  const result = await runBlueprint({
    blueprint: sdk.blueprint,
    values: sdk.sample,
    startedAt: 0,
    ports: {
      now: () => 0,
      openai: async () => ({ value: { improved: "clearer", notes: ["shorter"] }, inputTokens: 4, outputTokens: 6 }),
      helius: async () => {
        throw new Error("unused");
      },
    },
  });
  assert.equal(result.status, "SUCCESS");
  const body = publicExecution({
    executionId: "exec",
    sdkId: sdk.id,
    version: 1,
    contentHash: "a".repeat(64),
    status: result.status === "SUCCESS" ? "SUCCESS" : "FAILED",
    output: result.output ?? null,
    openaiRequests: result.openaiRequests,
    heliusRequests: result.heliusRequests,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
    startedAt: started.toISOString(),
    finishedAt: started.toISOString(),
  });
  assert.deepEqual(body.output, result.output);
  assert.equal(body.usage.openaiRequests, 1);
  assert.equal("traces" in body, false);
  assert.equal("task" in body, false);
  assert.equal(failureStatus("timeout"), "TIMEOUT");
  assert.equal(failureStatus("provider"), "FAILED");
});
