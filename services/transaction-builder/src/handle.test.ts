import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { executeAlt, refuseExecution } from "./alt-cli.ts";
import { ROUTES, handle, type HandlerPorts, type Produced } from "./handle.ts";
import { memoryStores } from "./store.ts";
import type { BuildRow, LaunchRecord, ParentRow } from "./domain.ts";
import { signServiceRequest } from "../../../lib/launch/service-auth.ts";

const LAUNCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LAUNCHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const ORIGINATOR = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const MINT = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";
const PARENT = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const SECRET = "builder-test-secret";
const HASH = "ab".repeat(32);

function launch(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    launchId: LAUNCH,
    accountId: ACCOUNT,
    walletAddress: LAUNCHER,
    idempotencyKey: KEY,
    status: "ready_for_transaction",
    sourceKind: "library",
    sourceId: OTHER,
    versionId: OTHER,
    contentHash: HASH,
    origin: "community",
    originatorAccountId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    originatorWallet: ORIGINATOR,
    feeCategory: "community_split",
    tokenName: "Fixture",
    tokenSymbol: "FIX",
    metadataHash: HASH,
    metadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    slippageBps: null,
    ...overrides,
  };
}

function produced(overrides: Partial<Produced> = {}): Produced {
  return {
    transaction: "unsigned-transaction",
    transactionVersion: 1,
    encoding: "base64",
    messageHash: "cd".repeat(32),
    byteLength: 900,
    accountCount: 32,
    fitsPacket: true,
    roles: ["create_v2", "create_fee_sharing_config", "quote_ata", "update_fee_shares_v2"],
    signers: [LAUNCHER, MINT],
    blockhash: "11111111111111111111111111111111",
    coverage: "live",
    simulationOk: true,
    parentMint: PARENT,
    ...overrides,
  };
}

function ports(input: {
  launch?: LaunchRecord | null;
  parent?: ParentRow | null;
  produce?: HandlerPorts["produce"];
}) {
  const launches = new Map(input.launch ? [[input.launch.launchId, input.launch]] : []);
  const builds: BuildRow[] = [];
  const memory = memoryStores({
    launches,
    parent: input.parent === undefined ? { mintAddress: PARENT, tokenProgram: null, altAddress: null, altAuthority: null, altStatus: "absent" } : input.parent,
    builds,
    nonces: new Set(),
  });
  const calls = { produce: 0 };
  const bound: HandlerPorts = {
    now: () => Date.now(),
    ...memory,
    produce: input.produce ?? (async () => {
      calls.produce += 1;
      return { ok: true, produced: produced() };
    }),
    async confirmParent() { return true; },
    async resimulate() { return true; },
  };
  return { bound, memory, launches, builds, calls };
}

function signed(path: string, body: Record<string, unknown>, nonce = randomBytes(16).toString("hex")) {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    method: "POST",
    path,
    body: payload,
    headers: {
      "x-sdk-timestamp": timestamp,
      "x-sdk-nonce": nonce,
      "x-sdk-signature": signServiceRequest({
        secret: SECRET,
        timestamp,
        nonce,
        method: "POST",
        path,
        body: payload,
      }),
    },
    secret: SECRET,
  };
}

const body = { launchId: LAUNCH, idempotencyKey: KEY, mintPublicKey: MINT };

test("routes expose no signing or broadcast method", () => {
  assert.deepEqual(ROUTES, ["GET /health", "GET /status", "POST /v1/diagnose", "POST /v1/build", "POST /v1/inspect"]);
  assert.equal(ROUTES.some((route) => /broadcast|sign/i.test(route)), false);
});

test("invalid signatures, expired timestamps, and reused nonces are rejected", async () => {
  const { bound } = ports({ launch: launch() });
  const request = signed("/v1/build", body);
  const bad = await handle({ ...request, headers: { ...request.headers, "x-sdk-signature": "ab".repeat(32) } }, bound);
  assert.equal(bad.status, 401);
  const expiredBody = JSON.stringify(body);
  const expired = await handle({
    method: "POST",
    path: "/v1/build",
    body: expiredBody,
    secret: SECRET,
    headers: {
      "x-sdk-timestamp": "1000000000",
      "x-sdk-nonce": "expirednoncevalue1",
      "x-sdk-signature": signServiceRequest({
        secret: SECRET,
        timestamp: "1000000000",
        nonce: "expirednoncevalue1",
        method: "POST",
        path: "/v1/build",
        body: expiredBody,
      }),
    },
  }, bound);
  assert.equal(expired.body.code, "timestamp");
  const first = await handle(request, bound);
  assert.equal(first.status, 200);
  const replay = await handle(request, bound);
  assert.equal(replay.body.code, "replay");
});

test("caller fees and a changed payload cannot alter the build", async () => {
  const { bound, launches } = ports({ launch: launch() });
  const extra = await handle(signed("/v1/build", { ...body, shareholders: [{ address: LAUNCHER, shareBps: 10000 }] }), bound);
  assert.equal(extra.body.code, "body");
  const program = await handle(signed("/v1/build", { ...body, programId: PARENT }), bound);
  assert.equal(program.status, 400);
  const created = await handle(signed("/v1/build", body), bound);
  assert.equal(created.body.authorized, false);
  assert.equal(created.body.coverage, "live");
  const current = launches.get(LAUNCH);
  assert.ok(current);
  current.metadataHash = "ef".repeat(32);
  const conflict = await handle(signed("/v1/build", body), bound);
  assert.equal(conflict.body.code, "conflict");
});

test("an unregistered parent and a fixture build are not returned as live", async () => {
  const missing = ports({ launch: launch(), parent: null });
  const unavailable = await handle(signed("/v1/build", body), missing.bound);
  assert.equal(unavailable.body.code, "parent_unregistered");
  assert.equal(missing.calls.produce, 0);
  const fixture = ports({
    launch: launch(),
    produce: async () => ({ ok: true, produced: produced({ coverage: "fixture" }) }),
  });
  const rejected = await handle(signed("/v1/build", body), fixture.bound);
  assert.equal(rejected.body.code, "coverage");
  assert.equal((await fixture.memory.builds.find(ACCOUNT, KEY)), null);
});

test("a failed simulation is not stored", async () => {
  const { bound, memory } = ports({
    launch: launch(),
    produce: async () => ({ ok: true, produced: produced({ simulationOk: false }) }),
  });
  const result = await handle(signed("/v1/build", body), bound);
  assert.equal(result.body.code, "simulation_failed");
  assert.equal(await memory.builds.find(ACCOUNT, KEY), null);
});

test("another open launch for the same wallet conflicts", async () => {
  const { bound, builds } = ports({ launch: launch() });
  builds.push({
    accountId: ACCOUNT,
    walletAddress: LAUNCHER,
    launchId: OTHER,
    idempotencyKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    payloadHash: HASH,
    messageHash: HASH,
    transaction: "stored",
    expiresAt: Date.now() + 60_000,
    parentMint: PARENT,
    mintAddress: MINT,
    blockhash: "11111111111111111111111111111111",
    contentHash: HASH,
    metadataHash: HASH,
    metadataUri: "https://example.com/metadata.json",
    buyAmount: "0",
    shareholdersJson: "[]",
  });
  const result = await handle(signed("/v1/build", body), bound);
  assert.equal(result.body.code, "conflict");
});

test("an authenticated diagnose reports an unregistered parent and rejects replay", async () => {
  const { bound } = ports({ launch: launch(), parent: null });
  const open = await handle({ method: "GET", path: "/status", headers: {}, body: "", secret: SECRET }, bound);
  assert.equal(open.body.parent, "unregistered");
  assert.equal(open.body.building, false);
  assert.equal(open.body.signing, false);
  assert.equal(open.body.broadcast, false);
  assert.equal("transaction" in open.body, false);
  const request = signed("/v1/diagnose", {});
  const diagnosed = await handle(request, bound);
  assert.equal(diagnosed.status, 200);
  assert.equal(diagnosed.body.parent, "unregistered");
  assert.equal(diagnosed.body.signing, false);
  const replay = await handle(request, bound);
  assert.equal(replay.body.code, "replay");
  const wrong = signed("/v1/diagnose", { shareholders: [] });
  assert.equal((await handle(wrong, bound)).body.code, "body");
});

test("execution refuses without reading a signer", async () => {
  assert.equal(refuseExecution(true, undefined), true);
  const result = await executeAlt({
    execute: true,
    approval: undefined,
    signerPath: "/this/path/is/not/read",
    rpcUrl: "https://example.invalid",
  });
  assert.deepEqual(result, { sent: false, reason: "refused" });
});
