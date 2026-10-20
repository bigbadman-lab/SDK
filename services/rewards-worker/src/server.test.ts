import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { readFileSync } from "node:fs";

function signer(): { secret: string; address: string } {
  const pair = nacl.sign.keyPair();
  return { secret: bs58.encode(pair.secretKey), address: new PublicKey(pair.publicKey).toBase58() };
}

function start(port: number, env: Record<string, string>): ChildProcess {
  return spawn(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--experimental-strip-types", "src/server.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        PORT: String(port),
        TREST_DEPLOYER_PRIVATE_KEY: "",
        TREST_DEPLOYER_ADDRESS: "",
        TREST_SIGNER_SUSPENDED: "",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForHealth(port: number): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return (await response.json()) as Record<string, unknown>;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("health");
}

test("the rewards worker source does not name a production deployer key", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("process.env.SDK_DEPLOYER_PRIVATE_KEY"), false);
  assert.equal(source.includes("sendTransaction"), false);
  assert.equal(source.includes("signTransaction"), false);
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes('REWARDS_LOOP_ENABLED === "true"') || source.includes("REWARDS_LOOP_ENABLED ?? null"), true);
  assert.equal(source.includes("REWARDS_EXECUTION_AUTHORIZED"), true);
  assert.equal(source.indexOf('import("./loop.ts")') > source.indexOf("rewardsExecutionEnabled"), true);
});

test("an unconfigured rewards worker stays up and does not sign", async () => {
  const port = 18131;
  const child = start(port, {});
  try {
    const health = await waitForHealth(port);
    assert.equal(health.signer, "unconfigured");
    assert.equal(health.signing, false);
    assert.equal(health.broadcasts, false);
    const refused = await fetch(`http://127.0.0.1:${port}/v1/collect`, { method: "POST", body: "{\"instructions\":[]}" });
    assert.equal(refused.status, 404);
    const body = await refused.json();
    assert.equal(JSON.stringify(body).includes("instructions"), false);
  } finally {
    child.kill("SIGTERM");
  }
});

test("a mismatched deployer key fails closed and is not logged", async () => {
  const key = signer();
  const child = start(18132, {
    TREST_DEPLOYER_PRIVATE_KEY: key.secret,
    TREST_DEPLOYER_ADDRESS: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
  });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5_000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      setTimeout(() => resolve(exitCode), 50);
    });
  });
  child.kill("SIGTERM");
  const text = Buffer.concat(chunks).toString("utf8");
  assert.equal(code, 1);
  assert.equal(text.includes(key.secret), false);
  assert.equal(text.includes("signer_mismatch"), true);
});

test("a matching suspended signer stays dark and does not echo the key", async () => {
  const key = signer();
  const port = 18133;
  const child = start(port, {
    TREST_DEPLOYER_PRIVATE_KEY: key.secret,
    TREST_DEPLOYER_ADDRESS: key.address,
    TREST_SIGNER_SUSPENDED: "true",
  });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  try {
    const health = await waitForHealth(port);
    const logged = Buffer.concat(chunks).toString("utf8");
    assert.equal(health.signer, "suspended");
    assert.equal(health.signing, false);
    assert.equal(health.broadcasts, false);
    assert.equal(JSON.stringify(health).includes(key.secret), false);
    assert.equal(logged.includes(key.secret), false);
  } finally {
    child.kill("SIGTERM");
  }
});
