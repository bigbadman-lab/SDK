import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { API_COPY, apiError } from "./contract.ts";

const page = readFileSync(
  new URL("../../app/code/page.tsx", import.meta.url),
  "utf8"
);

const EXECUTE_CODES = [
  "missing_api_key",
  "invalid_api_key",
  "revoked_api_key",
  "invalid_input",
  "sdk_not_found",
  "sdk_unavailable",
  "version_not_found",
  "quota_exceeded",
  "concurrency_limit",
  "spend_limit",
  "provider_failure",
  "timeout",
  "unavailable",
  "internal_error",
] as const;

test("the code page documents the published npm client", () => {
  assert.match(page, /npm install sdk-universal-client/);
  assert.match(
    page,
    /https:\/\/www\.npmjs\.com\/package\/sdk-universal-client/
  );
  assert.match(
    page,
    /import \{ SDKClient, SDKClientError \} from "sdk-universal-client"/
  );
  assert.match(page, /baseUrl: "https:\/\/sdk\.fund"/);
  assert.match(page, /eeed73cd-1971-5212-b882-ee6d0104941e/);
  assert.match(page, /e414c609-c017-55f6-ba74-5354a6a006d3/);
  assert.match(page, /POST https:\/\/sdk\.fund\/api\/v1\/sdk\/execute/);
  assert.match(page, /11111111111111111111111111111111/);
  assert.equal(page.includes("not published"), false);
  assert.equal(/\bnpm pack\b/.test(page), false);
  assert.equal(page.includes("packages/sdk-client"), false);
  assert.equal(page.includes("npm run build"), false);
});

test("the code page keeps the public execute error contract", () => {
  for (const code of EXECUTE_CODES) {
    const described = apiError(code);
    assert.equal(page.includes(code), true);
    assert.equal(page.includes(String(described.status)), true);
  }
  assert.equal(page.includes(API_COPY.missingApiKey), true);
  assert.equal(page.includes(API_COPY.invalidApiKey), true);
  assert.equal(page.includes(API_COPY.revokedApiKey), true);
  assert.equal(page.includes(API_COPY.invalidSdkInput), true);
  assert.equal(page.includes(API_COPY.invalidJson), true);
  assert.equal(page.includes(API_COPY.bodyTooLarge), true);
  assert.equal(page.includes(API_COPY.requestShape), true);
  assert.equal(page.includes(API_COPY.sdkNotFound), true);
  assert.equal(page.includes(API_COPY.sdkUnavailable), true);
  assert.equal(page.includes(API_COPY.versionNotFound), true);
  assert.equal(page.includes(API_COPY.quotaExceeded), true);
  assert.equal(page.includes(API_COPY.concurrencyLimit), true);
  assert.equal(page.includes(API_COPY.spendLimit), true);
  assert.equal(page.includes(API_COPY.providerFailure), true);
  assert.equal(page.includes(API_COPY.timeout), true);
  assert.equal(page.includes(API_COPY.unavailable), true);
  assert.equal(page.includes(API_COPY.internalError), true);
  assert.equal(page.includes("100 API executions"), true);
  assert.equal(page.includes("Two executions in flight"), true);
});
