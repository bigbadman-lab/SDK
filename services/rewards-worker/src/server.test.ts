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
        DATABASE_URL: "",
        HELIUS_RPC_URL: "",
        REWARDS_LOOP_ENABLED: "false",
        REWARDS_EXECUTION_AUTHORIZED: "false",
        TREST_DEPLOYER_PRIVATE_KEY: "",
        TREST_DEPLOYER_ADDRESS: "",
        TREST_SIGNER_SUSPENDED: "",
        SDK_DEPLOYER_PRIVATE_KEY: "",
        SDK_DEPLOYER_ADDRESS: "",
        SDK_SIGNER_SUSPENDED: "",
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

test("the rewards worker reads the production signer without logging or broadcasting it", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("SDK_DEPLOYER_PRIVATE_KEY"), true);
  assert.equal(source.includes("SDK_DEPLOYER_ADDRESS"), true);
  assert.equal(source.includes("SDK_SIGNER_SUSPENDED"), true);
  assert.equal(source.includes("delete process.env[name]"), true);
  assert.equal(source.includes("console.log"), false);
  assert.equal(source.includes("sendTransaction"), false);
  assert.equal(source.includes("signTransaction"), false);
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes("SIGTERM"), true);
  assert.equal(source.includes("SIGINT"), true);
  assert.equal(source.includes("requestShutdown"), true);
  assert.equal(source.includes('REWARDS_LOOP_ENABLED === "true"') || source.includes("REWARDS_LOOP_ENABLED ?? null"), true);
  assert.equal(source.includes("REWARDS_EXECUTION_AUTHORIZED"), true);
  assert.equal(source.includes('import("./loop.ts")'), false);
  assert.equal(source.includes("startRewardsLoop"), false);
  assert.equal(source.includes("TREST_DEPLOYER_ADDRESS"), false);
  assert.equal(source.includes("TREST_SIGNER_SUSPENDED"), false);
  assert.equal(source.includes("delete process.env.TREST_DEPLOYER_PRIVATE_KEY"), true);
  assert.equal(source.includes('import("./production-loop.ts")'), true);
  assert.equal(source.indexOf('import("./production-loop.ts")') > source.indexOf("rewardsExecutionEnabled"), true);
});

function assertDark(health: Record<string, unknown>, signer: string): void {
  const production = health.production as {
    canonicalMint?: string | null;
    signer?: string;
    rewards?: string;
    loop?: string;
    broadcasts?: string;
    claims?: string;
  };
  assert.equal(health.http, "ok");
  assert.equal(health.signing, false);
  assert.equal(health.broadcasts, false);
  assert.equal(health.loop, false);
  assert.equal(health.executionAuthorised, false);
  assert.equal(health.signer, signer);
  assert.equal(production.canonicalMint, null);
  assert.equal(production.signer, signer === "unconfigured" ? "missing" : signer);
  assert.equal(production.rewards, "inactive");
  assert.equal(production.loop, "stopped");
  assert.equal(production.broadcasts, "disabled");
  assert.equal(production.claims, "closed");
}

test("an unconfigured rewards worker stays up and does not sign", async () => {
  const port = 18131;
  const child = start(port, {});
  try {
    const health = await waitForHealth(port);
    assertDark(health, "unconfigured");
    assert.equal(health.runtime, "unconfigured");
    const refused = await fetch(`http://127.0.0.1:${port}/v1/collect`, { method: "POST", body: "{\"instructions\":[]}" });
    assert.equal(refused.status, 404);
    const body = await refused.json();
    assert.equal(JSON.stringify(body).includes("instructions"), false);
    const claims = await fetch(`http://127.0.0.1:${port}/v1/claims`, { method: "POST" });
    assert.equal(claims.status, 401);
  } finally {
    child.kill("SIGTERM");
  }
});

test("historical TREST credentials cannot select the production server loop", async () => {
  const trest = signer();
  const sdk = signer();
  const cases: { port: number; env: Record<string, string>; signer: string; secret: string }[] = [
    {
      port: 18132,
      signer: "unconfigured",
      secret: trest.secret,
      env: {
        TREST_DEPLOYER_PRIVATE_KEY: trest.secret,
        TREST_DEPLOYER_ADDRESS: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
        TREST_SIGNER_SUSPENDED: "false",
        REWARDS_LOOP_ENABLED: "true",
        REWARDS_EXECUTION_AUTHORIZED: "true",
      },
    },
    {
      port: 18133,
      signer: "unconfigured",
      secret: trest.secret,
      env: {
        TREST_DEPLOYER_PRIVATE_KEY: trest.secret,
        TREST_DEPLOYER_ADDRESS: trest.address,
        TREST_SIGNER_SUSPENDED: "true",
      },
    },
    {
      port: 18138,
      signer: "suspended",
      secret: sdk.secret,
      env: {
        SDK_DEPLOYER_PRIVATE_KEY: sdk.secret,
        SDK_DEPLOYER_ADDRESS: sdk.address,
        SDK_SIGNER_SUSPENDED: "true",
        TREST_DEPLOYER_PRIVATE_KEY: trest.secret,
        TREST_DEPLOYER_ADDRESS: trest.address,
        TREST_SIGNER_SUSPENDED: "false",
        REWARDS_LOOP_ENABLED: "true",
        REWARDS_EXECUTION_AUTHORIZED: "true",
      },
    },
  ];
  for (const item of cases) {
    const chunks: Buffer[] = [];
    const child = start(item.port, item.env);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    try {
      const health = await waitForHealth(item.port);
      assertDark(health, item.signer);
      const logged = Buffer.concat(chunks).toString("utf8");
      assert.equal(JSON.stringify(health).includes(item.secret), false);
      assert.equal(JSON.stringify(health).includes(trest.secret), false);
      assert.equal(logged.includes(item.secret), false);
      assert.equal(logged.includes(trest.secret), false);
      assert.equal(logged.includes("signer_mismatch"), false);
    } finally {
      child.kill("SIGTERM");
    }
  }
});

test("an authenticated claim stays inactive while financial execution is off", async () => {
  const port = 18134;
  const child = start(port, { REWARDS_WORKER_SECRET: "worker-secret-for-test" });
  try {
    await waitForHealth(port);
    const response = await fetch(`http://127.0.0.1:${port}/v1/claims`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sdk-worker-auth": "worker-secret-for-test" },
      body: JSON.stringify({ asset: "sol", instructions: [] }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "inactive");
    assert.equal(JSON.stringify(body).includes("signature"), false);
  } finally {
    child.kill("SIGTERM");
  }
});

test("a production key without execution flags stays dark and is not echoed", async () => {
  const key = signer();
  const port = 18135;
  const child = start(port, {
    SDK_DEPLOYER_PRIVATE_KEY: key.secret,
    SDK_DEPLOYER_ADDRESS: key.address,
  });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  try {
    const health = await waitForHealth(port);
    assertDark(health, "matched");
    assert.equal(health.runtime, "inactive");
    assert.equal(JSON.stringify(health).includes(key.secret), false);
    assert.equal(Buffer.concat(chunks).toString("utf8").includes(key.secret), false);
  } finally {
    child.kill("SIGTERM");
  }
});

test("a suspended production signer stays closed", async () => {
  const key = signer();
  const port = 18136;
  const child = start(port, {
    SDK_DEPLOYER_PRIVATE_KEY: key.secret,
    SDK_DEPLOYER_ADDRESS: key.address,
    SDK_SIGNER_SUSPENDED: "true",
  });
  try {
    const health = await waitForHealth(port);
    assertDark(health, "suspended");
    assert.equal(health.runtime, "suspended");
    assert.equal(JSON.stringify(health).includes(key.secret), false);
  } finally {
    child.kill("SIGTERM");
  }
});

test("a mismatched production key fails closed and is not logged", async () => {
  const key = signer();
  const child = start(18137, {
    SDK_DEPLOYER_PRIVATE_KEY: key.secret,
    SDK_DEPLOYER_ADDRESS: "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa",
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
