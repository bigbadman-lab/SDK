import assert from "node:assert/strict";
import test from "node:test";

import { SDKClient, SDKClientError } from "../src/index.ts";

const RESULT = {
  executionId: "exec",
  sdkId: "eeed73cd-1971-5212-b882-ee6d0104941e",
  version: 1,
  contentHash: "a".repeat(64),
  status: "SUCCESS",
  output: { improved: "clearer" },
  usage: { openaiRequests: 1, heliusRequests: 0, inputTokens: 3, outputTokens: 4 },
  durationMs: 12,
  startedAt: "2026-10-19T12:00:00.000Z",
  finishedAt: "2026-10-19T12:00:01.000Z",
};

test("a run sends one authenticated request and returns the output", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(RESULT), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new SDKClient({ apiKey: "sdk_test", baseUrl: "http://127.0.0.1:3000" });
    const result = await client.run({
      sdkId: RESULT.sdkId,
      version: 1,
      input: { prompt: "hello" },
    });
    assert.equal(result.output?.improved, "clearer");
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.url, "http://127.0.0.1:3000/api/v1/sdk/execute");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("authorization"), "Bearer sdk_test");
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["input", "sdkId", "version"]);
    assert.equal("blueprint" in body, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("api errors are mapped once and a cancelled run is not sent", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "quota_exceeded", message: "Daily limit.", remaining: 0 } }), {
      status: 429,
    });
  }) as typeof fetch;
  try {
    const client = new SDKClient({ apiKey: "sdk_test", baseUrl: "http://127.0.0.1:3000" });
    await assert.rejects(() => client.run({ sdkId: RESULT.sdkId, input: {} }), (error: unknown) => {
      assert.ok(error instanceof SDKClientError);
      assert.equal(error.code, "quota_exceeded");
      assert.equal(error.remaining, 0);
      return true;
    });
    assert.equal(calls, 1);
    const signal = new AbortController();
    signal.abort();
    await assert.rejects(() => client.run({ sdkId: RESULT.sdkId, input: {}, signal: signal.signal }), (error: unknown) => {
      assert.ok(error instanceof SDKClientError);
      assert.equal(error.code, "cancelled");
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
