import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDOFF_TTL_MS,
  beginGeneration,
  builderPath,
  createHandoff,
  homepageSend,
  readHandoff,
  resetGenerationState,
  settleGeneration,
  storeHandoff,
  type HandoffStorage,
} from "./handoff.ts";

function memory(): HandoffStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
}

test("a signed-out homepage send does not create a builder handoff", () => {
  assert.equal(homepageSend({ authenticated: false, prompt: "Summarize a wallet." }), "sign_in");
  assert.equal(homepageSend({ authenticated: true, prompt: "   " }), "empty");
  assert.equal(homepageSend({ authenticated: true, prompt: "Summarize a wallet." }), "build");
  assert.equal(createHandoff("   ", 1_000, "id-1"), null);
  assert.equal(builderPath(), "/build");
  assert.equal(builderPath().includes("Summarize"), false);
});

test("a homepage handoff starts generation once and then is gone", async () => {
  resetGenerationState();
  const storage = memory();
  const handoff = createHandoff("Summarize a wallet.", 1_000, "id-1");
  assert.ok(handoff);
  storeHandoff(storage, handoff);
  assert.equal(storage.raw.get("sdk.builder.handoff")?.includes("?"), false);
  let calls = 0;
  const run = async (prompt: string): Promise<string> => {
    calls += 1;
    return prompt;
  };
  const first = beginGeneration(storage, run, 1_000);
  const second = beginGeneration(storage, run, 1_000);
  assert.equal(first?.id, "id-1");
  assert.equal(second?.id, first?.id);
  assert.equal(await first?.promise, "Summarize a wallet.");
  assert.equal(await second?.promise, "Summarize a wallet.");
  assert.equal(calls, 1);
  assert.equal(storage.getItem("sdk.builder.handoff"), null);
  settleGeneration("id-1");
  assert.equal(beginGeneration(storage, run, 1_000), null);
  assert.equal(calls, 1);
});

test("an expired handoff is discarded and does not call the builder", () => {
  resetGenerationState();
  const storage = memory();
  const handoff = createHandoff("Summarize a wallet.", 1_000, "id-2");
  assert.ok(handoff);
  storeHandoff(storage, handoff);
  assert.equal(readHandoff(storage.getItem("sdk.builder.handoff"), 1_000 + HANDOFF_TTL_MS + 1), null);
  let calls = 0;
  assert.equal(
    beginGeneration(storage, async () => {
      calls += 1;
      return "no";
    }, 1_000 + HANDOFF_TTL_MS + 1),
    null,
  );
  assert.equal(calls, 0);
  assert.equal(storage.getItem("sdk.builder.handoff"), null);
});
