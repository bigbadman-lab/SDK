import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SDK_MARKET_REFRESH_MS, type SdkAllocation } from "./official.ts";
import type { RehearsalFigures } from "./rehearsal.ts";
import {
  appendAllocationRows,
  mergeAllocationRows,
  REWARD_REFRESH_MS,
  readRewardRefresh,
  rewardRefreshEnabled,
  rewardRefreshPath,
  settleRewardPoll,
  startRewardPoll,
} from "./reward-refresh.ts";

const HOLDER = "6D1yiRaZjxWKCG7aYVZf9hM2gAwCjb5zYcmHwvyNRtqp";
const START = "2026-10-24T12:50:00.000Z";
const END = "2026-10-24T12:55:00.000Z";
const EMPTY_START = "2026-10-24T12:55:00.000Z";

function row(id: string, start = START): SdkAllocation {
  return { id, windowStart: start, windowEnd: END, owner: HOLDER, balance: "16906756542762", solLamports: "1490307" };
}

function figures(windows: RehearsalFigures["windows"]): RehearsalFigures {
  return {
    collectedLamports: "8748187",
    distributableLamports: "8748187",
    holderLamports: "4374093",
    protocolLamports: "4374094",
    reserveLamports: "5000000",
    reserveSatisfied: false,
    allocatedLamports: "4374088",
    claimableLamports: "4374088",
    claimedLamports: "0",
    unassignedLamports: "5",
    latestStart: START,
    dayLamports: "4374093",
    windows,
  };
}

function payload(scope: "production" | "test", extra?: Record<string, unknown>) {
  return {
    ok: true,
    phase: "live",
    rows: [row("11111111-1111-4111-8111-111111111111")],
    nextCursor: null,
    summary: {
      totalLamports: "4374088",
      dayLamports: "4374088",
      latestWindowStart: START,
      latestWindowEnd: END,
    },
    figures: scope === "test" ? figures([{
      id: "window-1",
      start: START,
      status: "allocated",
      collectedLamports: "8748187",
      holderLamports: "4374093",
      protocolLamports: "4374094",
      eligibleHolders: 8,
      unassignedLamports: "5",
    }, {
      id: "rehearsal-empty",
      start: EMPTY_START,
      status: "empty",
      collectedLamports: null,
      holderLamports: null,
      protocolLamports: null,
      eligibleHolders: null,
      unassignedLamports: null,
    }]) : undefined,
    historical: { netLamports: "1" },
    ...extra,
  };
}

test("reward refresh follows the market interval and only runs for a live mint", () => {
  assert.equal(REWARD_REFRESH_MS, 15_000);
  assert.equal(REWARD_REFRESH_MS, SDK_MARKET_REFRESH_MS);
  assert.equal(rewardRefreshEnabled("live"), true);
  assert.equal(rewardRefreshEnabled("prelaunch"), false);
  assert.equal(rewardRefreshEnabled("unavailable"), false);
  assert.equal(rewardRefreshPath("production"), "/api/sdk/allocations");
  assert.equal(rewardRefreshPath("test"), "/api/sdk/allocations?scope=test");
});

test("a refresh accepts authoritative totals and does not invent an empty window", () => {
  const testView = readRewardRefresh(payload("test"), "test");
  assert.equal(testView?.figures?.holderLamports, "4374093");
  assert.equal(testView?.figures?.protocolLamports, "4374094");
  assert.equal(testView?.figures?.claimedLamports, "0");
  assert.equal(testView?.figures?.windows[1]?.status, "empty");
  assert.equal(testView?.figures?.windows[1]?.collectedLamports, null);
  assert.equal("historical" in (testView ?? {}), false);
  const withWindow = readRewardRefresh(payload("test", {
    figures: figures([{
      id: "window-2",
      start: "2026-10-24T13:00:00.000Z",
      status: "allocated",
      collectedLamports: "1000",
      holderLamports: "500",
      protocolLamports: "500",
      eligibleHolders: 1,
      unassignedLamports: "0",
    }]),
  }), "test");
  assert.equal(withWindow?.figures?.windows.length, 1);
  assert.equal(withWindow?.figures?.windows[0]?.id, "window-2");
  assert.equal(readRewardRefresh(payload("test", { figures: null }), "test"), null);
  assert.equal(readRewardRefresh(payload("test", { ok: false }), "test"), null);
  assert.equal(readRewardRefresh(payload("production"), "production")?.figures, null);
  assert.equal(readRewardRefresh({ ok: true, phase: "prelaunch", rows: [], summary: null }, "production"), null);
});

test("allocation pages keep older rows and ignore a repeated id", () => {
  const older = row("22222222-2222-4222-8222-222222222222", "2026-10-24T12:45:00.000Z");
  const current = row("11111111-1111-4111-8111-111111111111");
  const newer = row("33333333-3333-4333-8333-333333333333", "2026-10-24T13:00:00.000Z");
  const merged = mergeAllocationRows([current, older], [newer, { ...current, solLamports: "10" }]);
  assert.deepEqual(merged.map((item) => item.id), [newer.id, current.id, older.id]);
  assert.equal(merged[1]?.solLamports, "10");
  const appended = appendAllocationRows([current], [older, current]);
  assert.deepEqual(appended.map((item) => item.id), [current.id, older.id]);
});

test("hidden and overlapping polls do not replace a newer response", () => {
  const idle = { generation: 0, inFlight: false };
  assert.equal(startRewardPoll(idle, { hidden: true, reason: "interval" }).action, "skip");
  const first = startRewardPoll(idle, { hidden: false, reason: "interval" });
  assert.equal(first.action, "start");
  if (first.action !== "start") return;
  assert.equal(startRewardPoll(first.state, { hidden: false, reason: "interval" }).action, "skip");
  const visible = startRewardPoll(first.state, { hidden: false, reason: "visible" });
  assert.equal(visible.action, "start");
  if (visible.action !== "start") return;
  assert.equal(visible.requestId, 2);
  const stale = settleRewardPoll(visible.state, first.requestId);
  assert.equal(stale.apply, false);
  assert.equal(stale.state.inFlight, true);
  const current = settleRewardPoll(visible.state, visible.requestId);
  assert.equal(current.apply, true);
  assert.equal(current.state.inFlight, false);
  const again = startRewardPoll(current.state, { hidden: false, reason: "interval" });
  assert.equal(again.action, "start");
});

test("the allocations route stays read-only and the board polls it", () => {
  const route = readFileSync(new URL("../../app/api/sdk/allocations/route.ts", import.meta.url), "utf8");
  const board = readFileSync(new URL("../../components/sdk/sdk-board.tsx", import.meta.url), "utf8");
  const market = readFileSync(new URL("../../app/api/sdk/market/route.ts", import.meta.url), "utf8");
  assert.equal(route.includes("cache-control"), true);
  assert.equal(route.includes("private, no-store"), true);
  assert.equal(route.includes("figures: rehearsal.figures"), true);
  assert.equal(route.includes("export async function POST"), false);
  assert.equal(route.includes("rewards-worker"), false);
  assert.equal(board.includes("rewardRefreshPath"), true);
  assert.equal(board.includes("REWARD_REFRESH_MS"), true);
  assert.equal(board.includes("rewards-worker"), false);
  assert.equal(board.includes("Live · Updates automatically"), true);
  assert.equal(market.includes("loadRehearsalParent"), true);
  assert.equal(market.includes("loadRehearsalSdk"), false);
});
