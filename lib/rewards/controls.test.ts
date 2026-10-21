import assert from "node:assert/strict";
import test from "node:test";

import {
  REHEARSAL_CYCLE_CAP_LAMPORTS,
  REHEARSAL_RESERVE_LAMPORTS,
  REHEARSAL_SLIPPAGE_BPS,
  controlInitialisation,
  rehearsalControl,
} from "./controls.ts";

test("rehearsal controls stay suspended inside the configured bounds", () => {
  const configured = rehearsalControl();
  assert.equal(configured.ok, true);
  if (!configured.ok) return;
  assert.equal(configured.control.suspended, true);
  assert.equal(configured.control.reserveLamports, REHEARSAL_RESERVE_LAMPORTS);
  assert.equal(configured.control.cycleCapLamports, REHEARSAL_CYCLE_CAP_LAMPORTS);
  assert.equal(configured.control.slippageBps, REHEARSAL_SLIPPAGE_BPS);
  assert.equal(controlInitialisation({ scope: "test", symbol: "TREST", existing: false }), "create");
  assert.equal(controlInitialisation({ scope: "test", symbol: "TREST", existing: true }), "preserve");
  assert.equal(controlInitialisation({ scope: "production", symbol: "SDK", existing: false }), "reject");
  assert.equal(controlInitialisation({ scope: "production", symbol: "TREST", existing: false }), "reject");
  assert.equal(controlInitialisation({ scope: "test", symbol: "SDK", existing: false }), "reject");
});
