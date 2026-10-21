import assert from "node:assert/strict";
import test from "node:test";

import { rewardsExecutionEnabled } from "../../../lib/rewards/signer.ts";
import { authorisedTick } from "./loop.ts";

test("an authorised tick starts the cycle before claims and child distribution", async () => {
  const started: string[] = [];
  const open = await authorisedTick({
    suspended: false,
    emergencyFence: false,
    cycle: async () => {
      started.push("cycle");
    },
    claims: async () => {
      started.push("claims");
    },
    children: async () => {
      started.push("children");
    },
  });
  assert.equal(open.ordinary, true);
  assert.deepEqual(started, ["cycle", "claims", "children"]);
  const fenced = await authorisedTick({
    suspended: true,
    emergencyFence: false,
    cycle: async () => {
      started.push("cycle");
    },
    claims: async () => {
      started.push("claims");
    },
    children: async () => {
      started.push("children");
    },
  });
  assert.equal(fenced.ordinary, false);
  assert.deepEqual(started, ["cycle", "claims", "children", "cycle"]);
});

test("a suspended tick performs no claim or child signing", async () => {
  let signed = 0;
  const suspended = await authorisedTick({
    suspended: true,
    emergencyFence: false,
    cycle: async () => undefined,
    claims: async () => {
      signed += 1;
    },
    children: async () => {
      signed += 1;
    },
  });
  assert.equal(suspended.ordinary, false);
  assert.equal(signed, 0);
  assert.equal(rewardsExecutionEnabled({ loopEnabled: "true", executionAuthorised: "true", suspended: true }), false);
});
