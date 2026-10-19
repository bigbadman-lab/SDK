import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalAmount,
  feeCategory,
  httpsUri,
  idempotencyDecision,
  ipfsGatewayUri,
  metadataDocument,
  metadataStale,
  parseBuy,
  parsePrepareBody,
  parseTokenFields,
  payloadHashInput,
} from "./prepare.ts";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";
const KEY = "44444444-4444-4444-8444-444444444444";

test("fee categories come from trusted origin and account identity", () => {
  assert.equal(
    feeCategory({
      sourceOrigin: "official",
      launcherAccountId: DRAFT,
      originatorAccountId: OTHER,
    }),
    "official"
  );
  assert.equal(
    feeCategory({
      sourceOrigin: "official",
      launcherAccountId: DRAFT,
      originatorAccountId: DRAFT,
    }),
    "official"
  );
  assert.equal(
    feeCategory({
      sourceOrigin: "private",
      launcherAccountId: DRAFT,
      originatorAccountId: DRAFT,
    }),
    "originator_launch"
  );
  assert.equal(
    feeCategory({
      sourceOrigin: "private",
      launcherAccountId: DRAFT,
      originatorAccountId: null,
    }),
    "originator_launch"
  );
  assert.equal(
    feeCategory({
      sourceOrigin: "community",
      launcherAccountId: DRAFT,
      originatorAccountId: OTHER,
    }),
    "community_split"
  );
});

test("token fields use pump limits and do not truncate", () => {
  assert.equal(
    parseTokenFields({
      name: "N".repeat(33),
      symbol: "TICK",
      description: "A token",
      website: null,
      twitter: null,
      telegram: null,
    }).ok,
    false
  );
  assert.equal(
    parseTokenFields({
      name: "Name",
      symbol: "T".repeat(14),
      description: "A token",
      website: null,
      twitter: null,
      telegram: null,
    }).ok,
    false
  );
  const fields = parseTokenFields({
    name: "Name",
    symbol: "TICK",
    description: "A token",
    website: "https://sdk.fund",
    twitter: "https://x.com/sdk",
    telegram: "https://t.me/sdk",
  });
  assert.equal(fields.ok, true);
  assert.equal(
    parseTokenFields({
      name: "Name",
      symbol: "TICK",
      description: "A token",
      website: null,
      twitter: "https://example.com/not-x",
      telegram: null,
    }).ok,
    false
  );
});

test("developer buy is a decimal $SDK amount and metadata changes invalidate the pin", () => {
  assert.deepEqual(parseBuy("0", null), {
    ok: true,
    amount: "0",
    slippageBps: null,
  });
  assert.deepEqual(parseBuy("1.50", 100), {
    ok: true,
    amount: "1.5",
    slippageBps: 100,
  });
  assert.equal(parseBuy("1.5", null).ok, false);
  assert.equal(canonicalAmount("1e2"), null);
  assert.equal(parseBuy("0.000000001", 100).ok, true);
  const image = "https://gateway.example/ipfs/" + "b".repeat(50);
  assert.equal(httpsUri(image), true);
  const first = metadataDocument({
    fields: {
      name: "Name",
      symbol: "TICK",
      description: "One",
      website: null,
      twitter: null,
      telegram: null,
    },
    imageUri: image,
    createdOn: "https://sdk.fund",
  });
  const second = metadataDocument({
    fields: {
      name: "Other",
      symbol: "TICK",
      description: "One",
      website: null,
      twitter: null,
      telegram: null,
    },
    imageUri: image,
    createdOn: "https://sdk.fund",
  });
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(metadataStale(first.hashInput, second.hashInput), true);
    assert.equal(first.json.includes('"showName":true'), true);
    assert.equal(first.json.includes("createdOn"), true);
  }
  assert.equal(
    ipfsGatewayUri("gateway.example", "b".repeat(46))?.startsWith("https://"),
    true
  );
  assert.equal(ipfsGatewayUri("gateway.example", "short"), null);
});

test("preparation requests reject recipient fields and conflicting retries", () => {
  const body = {
    idempotencyKey: KEY,
    preparationId: null,
    source: { kind: "draft", draftId: DRAFT },
    name: "Name",
    symbol: "TICK",
    description: "A token",
    website: null,
    twitter: null,
    telegram: null,
    assetId: ASSET,
    buyAmount: "0",
    slippageBps: null,
  };
  assert.equal(parsePrepareBody(body).ok, true);
  assert.equal(parsePrepareBody({ ...body, recipient: OTHER }).ok, false);
  const parsed = parsePrepareBody(body);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const hash = payloadHashInput({
    source: parsed.value.source,
    contentHash: "a".repeat(64),
    fields: parsed.value.fields,
    assetHash: "b".repeat(64),
    buyAmount: parsed.value.buyAmount,
    slippageBps: parsed.value.slippageBps,
  });
  assert.equal(idempotencyDecision(null, hash), "create");
  assert.equal(idempotencyDecision(hash, hash), "reuse");
  assert.equal(idempotencyDecision(hash, `${hash}ff`), "conflict");
});
