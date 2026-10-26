import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { presentCreatorReceipt } from "./earnings-display.ts";

const TREST = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const VENT = "7Rrmq49nP4pFckExFxybJuqFwQbiKeGedbD22w5twvQB";
const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const CHILD = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SIGNATURE = "kEF7JqpqgybWQAapWxkkEvoyaud2yNKb3FvNTNVtfy7au4Z1RYH2g4s62ZbNWpSk3gcv4PZs4w1se4a3Tjg3PGE";

test("the verified VENT receipt displays TREST units, the child symbol, and the Solana explorer transaction", () => {
  const shown = presentCreatorReceipt({
    role: "launcher",
    scope: "test",
    mint: TREST,
    amount: "81561710516",
    signature: SIGNATURE,
    childMint: VENT,
    quoteSymbol: "TREST",
    quoteDecimals: 6,
    childSymbol: "VENT",
    receivedAt: "2026-10-26T11:38:29.093Z",
  });
  assert.ok(shown);
  assert.equal(shown.headline, "81,561.710516 TREST");
  assert.equal(shown.childLabel, "Creator fees from $VENT");
  assert.equal(shown.status, "Confirmed");
  assert.match(shown.receivedAt ?? "", /2026/);
  assert.equal(shown.explorerUrl, `https://explorer.solana.com/tx/${SIGNATURE}`);
  assert.equal(shown.headline.includes("81561710516"), false);
  assert.equal(shown.headline.includes("e+"), false);
});

test("a production receipt uses its own parent decimals and child symbol", () => {
  const shown = presentCreatorReceipt({
    role: "launcher",
    scope: "production",
    mint: SDK,
    amount: "81561710516",
    signature: SIGNATURE,
    childMint: CHILD,
    quoteSymbol: "SDK",
    quoteDecimals: 9,
    childSymbol: "CHILD",
    receivedAt: null,
  });
  assert.equal(shown?.headline, "81.561710516 SDK");
  assert.equal(shown?.childLabel, "Creator fees from $CHILD");
  assert.equal(shown?.receivedAt, null);
});

test("missing quote and child metadata fall back to abbreviated mints", () => {
  const shown = presentCreatorReceipt({
    role: "developer",
    scope: "test",
    mint: TREST,
    amount: "81561710516",
    signature: SIGNATURE,
    childMint: VENT,
    quoteSymbol: null,
    quoteDecimals: null,
    childSymbol: null,
    receivedAt: null,
  });
  assert.equal(shown?.headline, "81561710516 base units of BRQG…pump");
  assert.equal(shown?.childLabel, "Creator fees from 7Rrm…wvQB");
  assert.equal(shown?.headline.includes("TREST"), false);
  assert.equal(shown?.childLabel?.includes("$VENT"), false);
});

test("zero and unsigned rows are not shown as confirmed payments", () => {
  const base = {
    role: "launcher" as const,
    scope: "test" as const,
    mint: TREST,
    signature: SIGNATURE,
    quoteSymbol: "TREST" as const,
    quoteDecimals: 6,
  };
  assert.equal(presentCreatorReceipt({ ...base, amount: "0" }), null);
  assert.equal(presentCreatorReceipt({ ...base, amount: "1", signature: null }), null);
  assert.equal(presentCreatorReceipt({ ...base, amount: "1" })?.headline, "0.000001 TREST");
});

test("creator earnings cards keep an empty state and do not render raw base units", () => {
  const display = readFileSync(new URL("../../components/account/holder-rewards.tsx", import.meta.url), "utf8");
  const earnings = display.slice(display.indexOf("export function SdkEarnings"));
  assert.match(earnings, /No creator earnings received yet/);
  assert.match(earnings, /Original Developer/);
  assert.match(earnings, /presentCreatorReceipt/);
  assert.equal(earnings.includes("Received ${row.amount} of ${row.mint}"), false);
  assert.equal(earnings.includes("TREST"), false);
  assert.equal(earnings.includes("81561710516"), false);
});
