import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { altWarmth, selectStaticAltMembers } from "./alt.ts";
import { bindingDecision, payloadHash, type BuildIdentity } from "./build-binding.ts";
import { parseUnsignedBuildRequest } from "./builder-request.ts";
import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "./fees.ts";
import { quoteBaseUnits } from "./quote-units.ts";
import { signServiceRequest, verifyServiceRequest } from "./service-auth.ts";
import { slippagePercent } from "./slippage.ts";

const LAUNCHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const ORIGINATOR = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const HASH = "ab".repeat(32);

function shares(category: "community_split" | "originator_launch" | "official", launcher = LAUNCHER, originator: string | null = ORIGINATOR) {
  return allocateCreatorFees({
    category,
    launcherWallet: launcher,
    originatorWallet: originator,
    platformWallet: PLATFORM_FEE_WALLET,
  });
}

test("fee splits total 10000 and follow the three cases", () => {
  const community = shares("community_split");
  const own = shares("originator_launch", LAUNCHER, null);
  const official = shares("official", LAUNCHER, null);
  assert.equal(community.ok && own.ok && official.ok, true);
  if (!community.ok || !own.ok || !official.ok) return;
  assert.deepEqual(
    community.shareholders.map((holder) => holder.shareBps).sort((a, b) => a - b),
    [1500, 2500, 6000],
  );
  assert.deepEqual(own.shareholders.map((holder) => holder.shareBps).sort((a, b) => a - b), [1500, 8500]);
  assert.deepEqual(official.shareholders.map((holder) => holder.shareBps).sort((a, b) => a - b), [4000, 6000]);
  for (const result of [community, own, official]) {
    const addresses = result.shareholders.map((holder) => holder.address);
    assert.equal(new Set(addresses).size, addresses.length);
    assert.equal(result.shareholders.reduce((sum, holder) => sum + holder.shareBps, 0), 10_000);
  }
});

test("overlapping wallets combine and missing lineage fails", () => {
  const launcherOriginator = shares("community_split", LAUNCHER, LAUNCHER);
  const platformOriginator = shares("community_split", LAUNCHER, PLATFORM_FEE_WALLET);
  const launcherPlatform = shares("official", PLATFORM_FEE_WALLET, null);
  const allSame = shares("community_split", PLATFORM_FEE_WALLET, PLATFORM_FEE_WALLET);
  assert.equal(launcherOriginator.ok && platformOriginator.ok && launcherPlatform.ok && allSame.ok, true);
  if (!launcherOriginator.ok || !platformOriginator.ok || !launcherPlatform.ok || !allSame.ok) return;
  assert.deepEqual(launcherOriginator.shareholders.map((holder) => holder.shareBps).sort((a, b) => a - b), [1500, 8500]);
  assert.deepEqual(platformOriginator.shareholders.map((holder) => holder.shareBps).sort((a, b) => a - b), [4000, 6000]);
  assert.deepEqual(launcherPlatform.shareholders, [{ address: PLATFORM_FEE_WALLET, shareBps: 10_000 }]);
  assert.equal(allSame.shareholders.length, 1);
  assert.equal(shares("community_split", LAUNCHER, null).ok, false);
  assert.equal(shares("originator_launch", LAUNCHER, ORIGINATOR).ok, false);
  assert.equal(
    allocateCreatorFees({
      category: "official",
      launcherWallet: LAUNCHER,
      originatorWallet: null,
      platformWallet: LAUNCHER,
    }).ok,
    false,
  );
});

test("slippage basis points become Pump percent and raw basis points do not", () => {
  assert.deepEqual(slippagePercent(100), { ok: true, percent: 1 });
  assert.deepEqual(slippagePercent(1000), { ok: true, percent: 10 });
  assert.equal(slippagePercent(1).ok, false);
  assert.equal(slippagePercent(15).ok, false);
  assert.notEqual(slippagePercent(100), { ok: true, percent: 100 });
});

test("quote amounts convert in exact base units", () => {
  assert.deepEqual(quoteBaseUnits("1.5", 6), { ok: true, baseUnits: "1500000" });
  assert.deepEqual(quoteBaseUnits("0", 6), { ok: true, baseUnits: "0" });
  assert.equal(quoteBaseUnits("1.25", 1).ok, false);
  assert.equal(quoteBaseUnits("1.234", 2).ok, false);
  assert.equal(quoteBaseUnits("999999999999.999999999", 9).ok, false);
  assert.equal(quoteBaseUnits("1.0", 6).ok, true);
});

test("service signatures reject tampering, expiry, and bad nonces", () => {
  const body = JSON.stringify({ launchId: "x" });
  const input = {
    secret: "test-secret",
    timestamp: "1700000000",
    nonce: "nonce_nonce_nonce",
    method: "POST",
    path: "/v1/build",
    body,
  };
  const signature = signServiceRequest(input);
  assert.equal(verifyServiceRequest({ ...input, signature, nowSeconds: 1700000000 }).ok, true);
  assert.equal(verifyServiceRequest({ ...input, signature: "ab".repeat(32), nowSeconds: 1700000000 }).ok, false);
  assert.equal(verifyServiceRequest({ ...input, signature, nowSeconds: 1700000061 }).ok, false);
  assert.equal(verifyServiceRequest({ ...input, nonce: "short", signature, nowSeconds: 1700000000 }).ok, false);
  assert.equal(verifyServiceRequest({ ...input, body: "{}", signature, nowSeconds: 1700000000 }).ok, false);
});

test("the same idempotency key conflicts when the payload changes", () => {
  const identity = {
    launchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    mintPublicKey: LAUNCHER,
    launcherWallet: LAUNCHER,
    category: "official" as const,
    originatorWallet: null,
    metadataUri: "https://example.com/metadata.json",
    metadataHash: HASH,
    contentHash: HASH,
    sourceKind: "library" as const,
    sourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    versionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    buyAmount: "0",
    slippageBps: null,
    parentMint: ORIGINATOR,
    shareholders: [{ address: LAUNCHER, shareBps: 6000 }, { address: PLATFORM_FEE_WALLET, shareBps: 4000 }],
  } satisfies BuildIdentity;
  const hash = payloadHash(identity);
  const changed = payloadHash({ ...identity, metadataHash: createHash("sha256").update("other").digest("hex") });
  assert.notEqual(hash, changed);
  assert.equal(bindingDecision({
    now: 1_000,
    launchId: identity.launchId,
    idempotencyKey: identity.idempotencyKey,
    payloadHash: changed,
    existing: { launchId: identity.launchId, idempotencyKey: identity.idempotencyKey, payloadHash: hash, expiresAt: 2_000 },
    otherOpenLaunchIds: [],
  }), "conflict");
  assert.equal(bindingDecision({
    now: 3_000,
    launchId: identity.launchId,
    idempotencyKey: identity.idempotencyKey,
    payloadHash: hash,
    existing: { launchId: identity.launchId, idempotencyKey: identity.idempotencyKey, payloadHash: hash, expiresAt: 2_000 },
    otherOpenLaunchIds: [],
  }), "rebuild");
  assert.equal(bindingDecision({
    now: 1_000,
    launchId: identity.launchId,
    idempotencyKey: identity.idempotencyKey,
    payloadHash: hash,
    existing: null,
    otherOpenLaunchIds: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
  }), "conflict");
});

test("static lookup members exclude signers and duplicates", () => {
  const selected = selectStaticAltMembers({
    referenced: [LAUNCHER, ORIGINATOR, LAUNCHER, PLATFORM_FEE_WALLET],
    signers: [LAUNCHER],
    knownStatic: [ORIGINATOR, PLATFORM_FEE_WALLET, LAUNCHER],
  });
  assert.deepEqual(selected, [ORIGINATOR, PLATFORM_FEE_WALLET].sort());
  assert.equal(altWarmth({
    exists: false,
    authority: null,
    expectedAuthority: PLATFORM_FEE_WALLET,
    lastExtendedSlot: 1,
    currentSlot: 2,
    addresses: [],
    required: [],
  }), "absent");
  assert.equal(altWarmth({
    exists: true,
    authority: LAUNCHER,
    expectedAuthority: PLATFORM_FEE_WALLET,
    lastExtendedSlot: 1,
    currentSlot: 2,
    addresses: [ORIGINATOR],
    required: [ORIGINATOR],
  }), "authority");
  assert.equal(altWarmth({
    exists: true,
    authority: PLATFORM_FEE_WALLET,
    expectedAuthority: PLATFORM_FEE_WALLET,
    lastExtendedSlot: 5,
    currentSlot: 5,
    addresses: [ORIGINATOR],
    required: [ORIGINATOR],
  }), "warming");
  assert.equal(altWarmth({
    exists: true,
    authority: PLATFORM_FEE_WALLET,
    expectedAuthority: PLATFORM_FEE_WALLET,
    lastExtendedSlot: 4,
    currentSlot: 5,
    addresses: [ORIGINATOR],
    required: [ORIGINATOR],
  }), "warm");
});

test("build requests reject caller fees, quotes, and programs", () => {
  const valid = {
    launchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    mintPublicKey: LAUNCHER,
  };
  assert.equal(parseUnsignedBuildRequest(valid).ok, true);
  assert.equal(parseUnsignedBuildRequest({ ...valid, shareholders: [] }).ok, false);
  assert.equal(parseUnsignedBuildRequest({ ...valid, quoteMint: ORIGINATOR }).ok, false);
  assert.equal(parseUnsignedBuildRequest({ ...valid, programId: ORIGINATOR }).ok, false);
});

test("the 05C migration is additive and does not invent a mint", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20261019233000_phase_05c_transaction_builder.sql", import.meta.url)),
    "utf8",
  );
  assert.match(sql, /create table public\.sdk_parent_config/i);
  assert.match(sql, /create table public\.launch_builds/i);
  assert.match(sql, /create table public\.builder_nonces/i);
  assert.match(sql, /revoke all/i);
  assert.doesNotMatch(sql, /insert into public\.sdk_parent_config/i);
  assert.doesNotMatch(sql, /private key|deployer\.json|SDK_DEPLOYER_PRIVATE_KEY/i);
  assert.match(sql, /coverage = 'live'/);
  assert.match(sql, /char_length\(transaction\) between 16 and 8192/);
  assert.match(sql, /v1 construction does not require an address lookup table/);
  assert.doesNotMatch(sql, /alt_status = 'warm'/);
});
