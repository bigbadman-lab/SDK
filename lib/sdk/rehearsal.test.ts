import assert from "node:assert/strict";
import test from "node:test";

import { holderThreshold } from "../rewards/holders.ts";
import { composeRehearsalLedger, publicSdkRequest, readSdkRouteScope } from "./rehearsal.ts";

test("sdk scope accepts production and the TREST rehearsal only", () => {
  assert.equal(readSdkRouteScope(undefined), "production");
  assert.equal(readSdkRouteScope("test"), "test");
  assert.equal(readSdkRouteScope(""), null);
  assert.equal(readSdkRouteScope("production"), null);
  assert.equal(readSdkRouteScope("TREST"), null);
  assert.equal(publicSdkRequest(undefined), "production");
  assert.equal(publicSdkRequest(null), "production");
  assert.equal(publicSdkRequest("test"), "denied");
  assert.equal(publicSdkRequest("TREST"), "invalid");
});

test("rehearsal totals exclude deferred history and do not invent empty windows", () => {
  assert.equal(holderThreshold(6), "50000000000");
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  const start = now - 60_000;
  const figures = composeRehearsalLedger({
    collections: [
      { netLamports: "85140307", deferred: true },
      { netLamports: "1000", deferred: false },
    ],
    windows: [{
      id: "window-1",
      startMs: start,
      collectedLamports: "1000",
      holderLamports: "500",
      protocolLamports: "500",
      snapshotLamports: "400",
      eligibleHolders: 1,
    }],
    rehearsal: [
      { startMs: start - 300_000, outcome: "skipped" },
      { startMs: start, outcome: "ok" },
    ],
    claimedLamports: "100",
    reserveLamports: "5000000",
    recognizedReserveLamports: "5000000",
    nowMs: now,
  });
  assert.ok(figures);
  assert.equal(figures?.collectedLamports, "1000");
  assert.equal(figures?.holderLamports, "500");
  assert.equal(figures?.protocolLamports, "500");
  assert.equal(figures?.claimableLamports, "300");
  assert.equal(figures?.claimedLamports, "100");
  assert.equal(figures?.unassignedLamports, "100");
  assert.equal(figures?.reserveSatisfied, true);
  assert.equal(figures?.dayLamports, "500");
  assert.equal(figures?.windows[0]?.status, "allocated");
  assert.equal(figures?.windows[1]?.status, "skipped");
  assert.equal(figures?.windows[1]?.collectedLamports, null);
  const quiet = composeRehearsalLedger({
    collections: [{ netLamports: "85140307", deferred: true }],
    windows: [],
    rehearsal: [],
    claimedLamports: "0",
    reserveLamports: "5000000",
    recognizedReserveLamports: "5000000",
    nowMs: now,
  });
  assert.equal(quiet?.collectedLamports, null);
  assert.equal(quiet?.holderLamports, null);
  assert.equal(quiet?.windows.length, 0);
});