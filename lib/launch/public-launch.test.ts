import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicChildLaunchesOpen } from "./public-launch.ts";

test("public child launches stay closed until an explicit flag is set", () => {
  assert.equal(publicChildLaunchesOpen(undefined), false);
  assert.equal(publicChildLaunchesOpen(""), false);
  assert.equal(publicChildLaunchesOpen("false"), false);
  assert.equal(publicChildLaunchesOpen("true"), true);
  const discover = readFileSync(new URL("../server/launch/discover.ts", import.meta.url), "utf8");
  const registry = readFileSync(new URL("./registry.ts", import.meta.url), "utf8");
  const account = readFileSync(new URL("../../app/account/page.tsx", import.meta.url), "utf8");
  const paired = readFileSync(new URL("../../app/paired/page.tsx", import.meta.url), "utf8");
  const sdk = readFileSync(new URL("../../app/sdk/page.tsx", import.meta.url), "utf8");
  const market = readFileSync(new URL("../../app/api/sdk/market/route.ts", import.meta.url), "utf8");
  const allocations = readFileSync(new URL("../../app/api/sdk/allocations/route.ts", import.meta.url), "utf8");
  const submit = readFileSync(new URL("../../app/api/launch/submit/route.ts", import.meta.url), "utf8");
  const recover = readFileSync(new URL("../../app/api/launch/recover/route.ts", import.meta.url), "utf8");
  assert.match(discover, /scope: "production"/);
  assert.match(registry, /s\.scope = \$\{scope\}/);
  assert.equal(account.includes("scope=test"), false);
  assert.equal(account.includes("TREST"), false);
  assert.equal(paired.includes("TREST"), false);
  assert.equal(sdk.includes("TREST_MINT"), false);
  assert.equal(sdk.includes("RehearsalSdkPage"), false);
  assert.match(market, /status: 404/);
  assert.match(allocations, /404/);
  assert.match(submit, /publicChildLaunchesOpen/);
  assert.match(recover, /publicChildLaunchesOpen/);
});
