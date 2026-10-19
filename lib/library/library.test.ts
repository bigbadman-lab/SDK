import assert from "node:assert/strict";
import test from "node:test";

import { saveAllowed } from "../blueprint/save.ts";
import {
  OFFICIAL_SDK_NAMES,
  ilikePattern,
  isOfficialSdkName,
  libraryHref,
  libraryQuery,
  nextLibraryVersion,
  originAllowsName,
  remixCopy,
  visibleInLibrary,
} from "./library.ts";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const SDK = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const REMIXER = "33333333-3333-4333-8333-333333333333";
const ORIGINATOR = "44444444-4444-4444-8444-444444444444";

test("the official registry is the ten approved names", () => {
  assert.deepEqual(OFFICIAL_SDK_NAMES, [
    "Prompt Architect",
    "Data Alchemist",
    "Document Intelligence",
    "World Engine",
    "PersonaOS",
    "Decision Lab",
    "Chain Investigator",
    "Token Forensics",
    "Wallet DNA",
    "Venture Forge",
  ]);
  assert.equal(originAllowsName("official", "Prompt Architect"), true);
  assert.equal(originAllowsName("official", "Custom SDK"), false);
  assert.equal(originAllowsName("community", "Prompt Architect"), false);
  assert.equal(originAllowsName("community", "Custom SDK"), true);
  assert.equal(isOfficialSdkName("Wallet DNA"), true);
});

test("a private save is not a public listing", () => {
  assert.equal(visibleInLibrary(null), false);
  assert.equal(visibleInLibrary("pending"), false);
  assert.equal(visibleInLibrary("published"), true);
});

test("a published blueprint version is never edited in place", () => {
  assert.deepEqual(nextLibraryVersion({ validated: false, hash: HASH, versions: [] }), { action: "reject" });
  assert.deepEqual(
    nextLibraryVersion({ validated: true, hash: HASH, versions: [] }),
    { action: "append", versionNumber: 1 },
  );
  assert.deepEqual(
    nextLibraryVersion({
      validated: true,
      hash: HASH,
      versions: [{ versionNumber: 1, contentHash: HASH }],
    }),
    { action: "reuse", versionNumber: 1 },
  );
  assert.deepEqual(
    nextLibraryVersion({
      validated: true,
      hash: OTHER,
      versions: [{ versionNumber: 1, contentHash: HASH }],
    }),
    { action: "append", versionNumber: 2 },
  );
});

test("a remix keeps source lineage and stays private", () => {
  const copy = remixCopy({
    remixerAccountId: REMIXER,
    source: {
      sdkId: SDK,
      versionId: VERSION,
      contentHash: HASH,
      blueprintHash: HASH,
      originatorAccountId: ORIGINATOR,
      originatorLabel: "SDK",
    },
  });
  assert.equal(copy.ok, true);
  if (!copy.ok) return;
  assert.equal(copy.savedAt, null);
  assert.equal(copy.published, false);
  assert.equal(visibleInLibrary(null), false);
  assert.equal(saveAllowed(copy.contentHash, null), false);
  assert.equal(copy.ownerAccountId, REMIXER);
  assert.equal(copy.sourceSdkId, SDK);
  assert.equal(copy.sourceVersionId, VERSION);
  assert.equal(copy.originatorAccountId, ORIGINATOR);
  assert.notEqual(copy.ownerAccountId, copy.originatorAccountId);
  assert.equal(
    remixCopy({
      remixerAccountId: REMIXER,
      source: {
        sdkId: SDK,
        versionId: VERSION,
        contentHash: HASH,
        blueprintHash: OTHER,
        originatorAccountId: ORIGINATOR,
        originatorLabel: "SDK",
      },
    }).ok,
    false,
  );
});

test("library search stays bounded", () => {
  const query = libraryQuery({ q: "  wallet   dna  ", origin: "nope", page: "2" });
  assert.equal(query.q, "wallet dna");
  assert.equal(query.origin, null);
  assert.equal(query.page, 2);
  assert.equal(query.offset, 12);
  assert.equal(libraryHref({ q: "wallet", origin: "official", page: 1 }), "/library?q=wallet&origin=official");
  assert.equal(ilikePattern("100%_done"), "%100\\%\\_done%");
});
