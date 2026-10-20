import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PLATFORM_FEE_WALLET } from "../../../lib/launch/fees.ts";

function start(port: number, env: Record<string, string>) {
  const child = spawn(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--experimental-strip-types", "src/server.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PORT: String(port), ...env },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  return child;
}

async function waitForHealth(port: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("health");
}

test("an unconfigured builder stays up and does not pretend the parent is ready", async () => {
  const port = 18115;
  const child = start(port, {
    TX_BUILDER_SECRET: "",
    DATABASE_URL: "",
    HELIUS_RPC_URL: "",
    SDK_PLATFORM_FEE_WALLET: "",
  });
  try {
    await waitForHealth(port);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const status = await fetch(`http://127.0.0.1:${port}/status`);
    const body = (await status.json()) as Record<string, unknown>;
    assert.equal(status.status, 200);
    assert.equal(body.configured, false);
    assert.equal(body.parent, "unregistered");
    assert.equal(body.building, false);
    assert.equal(body.signing, false);
    assert.equal(body.broadcast, false);
    assert.equal(JSON.stringify(body).includes("postgres"), false);
    const rejected = await fetch(`http://127.0.0.1:${port}/v1/build`, { method: "POST", body: "{}" });
    assert.equal(rejected.status, 503);
    assert.equal(PLATFORM_FEE_WALLET.length > 0, true);
  } finally {
    child.kill("SIGTERM");
  }
});
