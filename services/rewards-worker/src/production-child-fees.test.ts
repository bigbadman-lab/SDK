import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLATFORM_FEE_WALLET } from "../../../lib/launch/fees.ts";
import { DISTRIBUTE_CREATOR_FEES_V2, PUMP_PROGRAM_ID } from "../../../lib/rewards/child-fees.ts";
import { accountingWindow } from "../../../lib/rewards/ledger.ts";
import { serviceChildFees, type ChildCandidate } from "./child-fees.ts";

const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const FIRST = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SECOND = "9NXoqw9svrX4kD3bRkxQuyV5bkxeQugLgkJr2z5EnXjw";
const LAUNCHER = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";

function child(mint: string): ChildCandidate {
  return {
    mint,
    quoteMint: SDK,
    scope: "production",
    category: "official",
    launcher: LAUNCHER,
    originator: null,
  };
}

const instruction = {
  programId: PUMP_PROGRAM_ID,
  data: [...DISTRIBUTE_CREATOR_FEES_V2],
  keys: [],
};

test("a stuck production child does not block the next child", async () => {
  const submitted: string[] = [];
  const result = await serviceChildFees({
    nowMs: Date.now(),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [child(FIRST), child(SECOND)],
    completedKeys: [],
    readConfig: async (candidate) => {
      if (candidate.mint === FIRST) throw new Error("stuck");
      return {
        adminRevoked: true,
        shareholders: [
          { address: LAUNCHER, shareBps: 6000 },
          { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
        ],
      };
    },
    prepare: async () => [instruction],
    submit: async (candidate) => {
      submitted.push(candidate.mint);
      return { status: "confirmed", receipts: [{ address: LAUNCHER, amount: "1" }] };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(submitted, [SECOND]);
});

test("an uncertain or previously submitted production intent is not broadcast again after a restart", async () => {
  const window = accountingWindow(Date.now());
  assert.ok(window);
  if (!window) return;
  const key = `child:production:${FIRST}:${window.startMs}`;
  let submits = 0;
  const first = await serviceChildFees({
    nowMs: Date.now(),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [child(FIRST)],
    completedKeys: [],
    readConfig: async () => ({
      adminRevoked: true,
      shareholders: [
        { address: LAUNCHER, shareBps: 6000 },
        { address: PLATFORM_FEE_WALLET, shareBps: 4000 },
      ],
    }),
    prepare: async () => [instruction],
    submit: async (candidate, idempotencyKey) => {
      submits += 1;
      assert.equal(candidate.mint, FIRST);
      assert.equal(idempotencyKey, key);
      return { status: "uncertain" };
    },
  });
  assert.equal(first.ok, true);
  assert.equal(submits, 1);
  const restarted = await serviceChildFees({
    nowMs: Date.now(),
    authorised: true,
    suspended: false,
    emergencyFence: false,
    children: [child(FIRST)],
    completedKeys: [key],
    readConfig: async () => {
      throw new Error("must not read a completed child");
    },
    prepare: async () => {
      throw new Error("must not prepare a completed child");
    },
    submit: async () => {
      submits += 1;
      return { status: "confirmed", receipts: [{ address: LAUNCHER, amount: "1" }] };
    },
  });
  assert.equal(restarted.ok, true);
  if (!restarted.ok) return;
  assert.equal(restarted.submitted, 0);
  assert.equal(submits, 1);
});

test("the production loop keeps child fees inside the existing tick and does not follow parent rewards", () => {
  const production = readFileSync(new URL("./production-loop.ts", import.meta.url), "utf8");
  assert.match(production, /runProductionChildPass/);
  assert.match(production, /beginTick\(\)/);
  assert.match(production, /endTick\(\)/);
  assert.match(production, /nextUtcWindowDelay/);
  assert.equal(production.includes("parent_scope = 'test'"), false);
  assert.equal(production.includes("SDK_DEPLOYER_PRIVATE_KEY"), false);
  const children = production.slice(production.indexOf("children: async"), production.indexOf("})().catch"));
  assert.equal(children.includes("rewardsActive"), true);
  assert.equal(children.includes("if (!rewardsActive"), false);
  assert.match(children, /childFeesActive: flags\.childFeesActive/);
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.ok(server.indexOf('import("./production-loop.ts")') > server.indexOf("rewardsExecutionEnabled"));
  assert.equal(server.includes('import("./loop.ts")'), false);
});
