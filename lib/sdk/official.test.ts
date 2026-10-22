import assert from "node:assert/strict";
import test from "node:test";

import { TREST_MINT } from "../launch/verified-launch.ts";
import { nativeRewardSplit } from "./rewards-copy.ts";
import {
  acceptOfficialMint,
  allocationCursor,
  formatHolderCount,
  formatSol,
  formatTokenBalance,
  formatTokenPrice,
  formatUsdCompact,
  formatUtcStamp,
  formatWindow,
  officialQuoteFromOverview,
  readAllocationCursor,
} from "./official.ts";

const MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";

test("an official quote uses market cap and price, and ignores FDV", () => {
  const quote = officialQuoteFromOverview({
    data: { marketCap: 980.18, price: 0.00001234, v24hUSD: 147.8, holder: 2, fdv: 9_000_000 },
  });
  assert.equal(quote.marketCapUsd, 980.18);
  assert.equal(quote.priceUsd, 0.00001234);
  assert.equal(formatUsdCompact(quote.marketCapUsd), "$980");
  assert.equal(formatTokenPrice(quote.priceUsd), "$0.00001234");
  assert.equal(formatUsdCompact(quote.volumeUsd), "$148");
  assert.equal(formatHolderCount(quote.holders), "2");
  assert.equal(officialQuoteFromOverview({ data: { fdv: 100 } }).marketCapUsd, null);
  assert.equal(officialQuoteFromOverview({ data: { marketCap: -1, price: "1", v24hUSD: null, holder: 1.2 } }).priceUsd, null);
  assert.equal(formatTokenPrice(null), "—");
  assert.equal(formatUsdCompact(0), "$0");
});

test("the official mint rejects an empty row and the TREST mint", () => {
  assert.equal(acceptOfficialMint(null, 6), null);
  assert.equal(acceptOfficialMint(TREST_MINT, 6), null);
  assert.equal(acceptOfficialMint("not-a-mint", 6), null);
  assert.deepEqual(acceptOfficialMint(MINT, 6), { mint: MINT, decimals: 6 });
  assert.deepEqual(acceptOfficialMint(MINT, null), { mint: MINT, decimals: null });
  assert.deepEqual(acceptOfficialMint(MINT, 12), { mint: MINT, decimals: null });
});

test("holder rewards stay on the ledger split and a five-minute window", () => {
  const split = nativeRewardSplit();
  assert.deepEqual(split, { holders: "30", buyback: "30", deployer: "40" });
  assert.equal(formatSol("1500000000"), "1.5 SOL");
  assert.equal(formatSol("1"), "0.000000001 SOL");
  assert.equal(formatSol("0"), "0 SOL");
  assert.equal(formatTokenBalance("50000000000", 6), "50,000");
  assert.equal(formatTokenBalance("50000000000", null), "—");
  assert.equal(formatUtcStamp(Date.parse("2026-10-22T17:15:00.000Z")), "22 Oct 2026, 17:15:00 UTC");
  assert.equal(
    formatWindow("2026-10-22T17:15:00.000Z", "2026-10-22T17:20:00.000Z"),
    "22 Oct 2026, 17:15–17:20 UTC",
  );
});

test("allocation cursors only accept a timestamp and an id", () => {
  const cursor = allocationCursor("2026-10-22T17:15:00.000Z", "11111111-1111-4111-8111-111111111111");
  assert.equal(cursor, "2026-10-22T17:15:00.000Z~11111111-1111-4111-8111-111111111111");
  assert.deepEqual(readAllocationCursor(cursor), {
    start: "2026-10-22T17:15:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(readAllocationCursor("2026-10-22T17:15:00.000Z~not-an-id"), null);
  assert.equal(allocationCursor("yesterday", "11111111-1111-4111-8111-111111111111"), null);
});
