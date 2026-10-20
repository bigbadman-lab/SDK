import assert from "node:assert/strict";
import test from "node:test";

import { builderFailureCode, readBuilderLinkReport } from "./builder-probe.ts";
import { parseLauncherBuildRequest } from "./builder-request.ts";

const ready = {
  ok: true,
  configured: true,
  database: "ok",
  rpc: "ok",
  parent: "unregistered",
  building: false,
  signing: false,
  broadcast: false,
};

test("a builder link report must keep signing and broadcasting off", () => {
  assert.equal(readBuilderLinkReport(ready).ok, true);
  assert.equal(readBuilderLinkReport({ ...ready, signing: true }).ok, false);
  assert.equal(readBuilderLinkReport({ ...ready, broadcast: true }).ok, false);
  assert.equal(readBuilderLinkReport({ ...ready, building: true }).ok, false);
  assert.equal(readBuilderLinkReport({ ...ready, database: "postgres://secret" }).ok, false);
});

test("builder failures stay on a known code list", () => {
  assert.equal(builderFailureCode({ code: "parent_unregistered" }), "parent_unregistered");
  assert.equal(builderFailureCode({ code: "signature" }), "builder_rejected");
  assert.equal(builderFailureCode({ code: "postgres://database" }), "builder_rejected");
});

test("a launcher build request cannot supply fees or a quote", () => {
  const valid = {
    launchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mintPublicKey: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC",
  };
  assert.equal(parseLauncherBuildRequest(valid).ok, true);
  assert.equal(parseLauncherBuildRequest({ ...valid, shareholders: [] }).ok, false);
  assert.equal(parseLauncherBuildRequest({ ...valid, idempotencyKey: valid.launchId }).ok, false);
});
