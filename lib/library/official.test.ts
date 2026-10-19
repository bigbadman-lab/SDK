import assert from "node:assert/strict";
import test from "node:test";

import { contentHash } from "../blueprint/json.ts";
import { MAX_RUN_MS, MAX_STEPS, OPERATIONS } from "../blueprint/model.ts";
import { validateBlueprint, validateInputsAgainst } from "../blueprint/validate.ts";
import { OFFICIAL_SDK_NAMES, remixCopy } from "./library.ts";
import { OFFICIAL_ORIGINATOR_LABEL, OFFICIAL_SDKS, officialSdkId, officialSeedPlan, uuidV5 } from "./official.ts";

const REMIXER = "33333333-3333-4333-8333-333333333333";
const VERSION = "22222222-2222-4222-8222-222222222222";
const ORIGINATOR = "44444444-4444-4444-8444-444444444444";

test("official identifiers are stable uuid version 5 values", () => {
  assert.equal(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  assert.equal(OFFICIAL_SDKS.length, 10);
  assert.deepEqual(
    OFFICIAL_SDKS.map((sdk) => sdk.name),
    [...OFFICIAL_SDK_NAMES],
  );
  const ids = OFFICIAL_SDKS.map((sdk) => sdk.id);
  assert.equal(new Set(ids).size, 10);
  for (const sdk of OFFICIAL_SDKS) assert.equal(sdk.id, officialSdkId(sdk.name));
});

test("each official blueprint is valid, bounded, and executable by the shared contract", () => {
  const hashes = new Set<string>();
  for (const sdk of OFFICIAL_SDKS) {
    const validated = validateBlueprint(sdk.blueprint);
    assert.equal(validated.ok, true, sdk.name);
    if (!validated.ok) continue;
    const blueprint = validated.blueprint;
    assert.equal(blueprint.name, sdk.name);
    assert.equal(blueprint.description, sdk.description);
    assert.ok(blueprint.description.length <= 500);
    assert.ok(blueprint.steps.length >= 1 && blueprint.steps.length <= MAX_STEPS);
    assert.ok(blueprint.steps.length <= 5);
    for (const step of blueprint.steps) {
      assert.ok(OPERATIONS.includes(step.op));
      if (typeof step.config.task === "string") assert.ok(step.config.task.length <= 2_000);
    }
    assert.deepEqual(blueprint.capabilities, [...new Set(blueprint.steps.map((step) => step.op))]);
    assert.ok(blueprint.limits.timeoutMs <= MAX_RUN_MS);
    assert.equal(blueprint.limits.maxOutputBytes, 131_072);
    assert.deepEqual(Object.keys(blueprint.inputs), Object.keys(sdk.guide));
    assert.deepEqual(Object.keys(sdk.sample).sort(), Object.keys(blueprint.inputs).sort());
    const inputs = validateInputsAgainst(blueprint, sdk.sample);
    assert.equal(inputs.ok, true, sdk.name);
    assert.ok(Object.keys(blueprint.outputs).length >= 1);
    const hash = contentHash(blueprint);
    assert.equal(hash, contentHash(blueprint));
    assert.equal(hashes.has(hash), false);
    hashes.add(hash);
    const copy = remixCopy({
      remixerAccountId: REMIXER,
      source: {
        sdkId: sdk.id,
        versionId: VERSION,
        contentHash: hash,
        blueprintHash: hash,
        originatorAccountId: ORIGINATOR,
        originatorLabel: OFFICIAL_ORIGINATOR_LABEL,
      },
    });
    assert.equal(copy.ok, true);
    if (!copy.ok) continue;
    assert.equal(copy.savedAt, null);
    assert.equal(copy.published, false);
    assert.equal(copy.ownerAccountId, REMIXER);
    assert.equal(copy.sourceSdkId, sdk.id);
    assert.equal(copy.originatorAccountId, ORIGINATOR);
    assert.equal(copy.originatorLabel, "SDK");
  }
});

test("official seeding creates once and then reuses the same version", () => {
  const sdk = OFFICIAL_SDKS[0];
  assert.ok(sdk);
  const validated = validateBlueprint(sdk.blueprint);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const hash = contentHash(validated.blueprint);
  assert.deepEqual(officialSeedPlan({ existing: null, sdk: { id: sdk.id, contentHash: hash } }), { action: "create" });
  assert.deepEqual(
    officialSeedPlan({ existing: { id: sdk.id, contentHash: hash }, sdk: { id: sdk.id, contentHash: hash } }),
    { action: "reuse" },
  );
  assert.deepEqual(
    officialSeedPlan({ existing: { id: sdk.id, contentHash: null }, sdk: { id: sdk.id, contentHash: hash } }),
    { action: "attach" },
  );
  assert.deepEqual(
    officialSeedPlan({ existing: { id: sdk.id, contentHash: "b".repeat(64) }, sdk: { id: sdk.id, contentHash: hash } }),
    { action: "reject", code: "official_changed" },
  );
  assert.deepEqual(
    officialSeedPlan({
      existing: { id: "55555555-5555-4555-8555-555555555555", contentHash: hash },
      sdk: { id: sdk.id, contentHash: hash },
    }),
    { action: "reject", code: "official_id" },
  );
});
