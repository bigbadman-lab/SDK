import assert from "node:assert/strict";
import test from "node:test";

import { runBlueprint } from "../blueprint/execute.ts";
import { OFFICIAL_SDKS } from "../library/official.ts";
import {
  API_COPY,
  activeKeySlot,
  apiError,
  apiQuota,
  failureStatus,
  keyLookup,
  presentedKey,
  publicExecution,
  publishedVersionChoice,
} from "./contract.ts";

test("public API messages keep their codes and statuses", () => {
  const cases: Array<[Parameters<typeof apiError>[0], number, string]> = [
    ["missing_api_key", 401, API_COPY.missingApiKey],
    ["invalid_api_key", 401, API_COPY.invalidApiKey],
    ["revoked_api_key", 401, API_COPY.revokedApiKey],
    ["unauthenticated", 401, "Sign in to manage API keys."],
    ["invalid_input", 400, API_COPY.invalidSdkInput],
    ["sdk_not_found", 404, API_COPY.sdkNotFound],
    ["sdk_unavailable", 404, API_COPY.sdkUnavailable],
    ["version_not_found", 404, API_COPY.versionNotFound],
    ["quota_exceeded", 429, API_COPY.quotaExceeded],
    ["concurrency_limit", 429, API_COPY.concurrencyLimit],
    ["spend_limit", 429, API_COPY.spendLimit],
    ["provider_failure", 502, API_COPY.providerFailure],
    ["timeout", 504, API_COPY.timeout],
    ["unavailable", 503, API_COPY.unavailable],
    ["internal_error", 500, API_COPY.internalError],
    ["key_limit", 409, API_COPY.keyLimit],
    ["key_not_found", 404, API_COPY.keyNotFound],
  ];
  for (const [code, status, message] of cases) {
    assert.deepEqual(apiError(code), { status, code, message });
  }
  assert.equal(API_COPY.quotaExceeded.includes("100"), true);
  assert.equal(API_COPY.invalidJson.includes("valid JSON"), true);
  assert.equal(API_COPY.requestShape.includes("SDK ID"), true);
});

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
