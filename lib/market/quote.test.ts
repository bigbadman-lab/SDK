import assert from "node:assert/strict";
import test from "node:test";

import { formatAge, formatCount, formatUsd, quoteFromOverview } from "./quote.ts";

test("an overview snapshot keeps FDV, 24h volume, and holders", () => {
  const quote = quoteFromOverview({
    data: { fdv: 26300, v24hUSD: 915000, holder: 1886, price: 0.01 },
  });
  assert.deepEqual(quote, { fdv: 26300, volumeUsd: 915000, holders: 1886 });
  assert.equal(formatUsd(quote.fdv), "$26.3K");
  assert.equal(formatUsd(quote.volumeUsd), "$915K");
  assert.equal(formatCount(quote.holders), "1,886");
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(212_000), "$212K");
  assert.equal(formatUsd(43_300), "$43.3K");
  assert.equal(formatCount(12_600), "12.6K");
});

test("missing or invalid market fields stay blank", () => {
  assert.deepEqual(quoteFromOverview(null), { fdv: null, volumeUsd: null, holders: null });
  assert.deepEqual(quoteFromOverview({ data: null }), { fdv: null, volumeUsd: null, holders: null });
  assert.deepEqual(quoteFromOverview({ data: { fdv: -1, v24hUSD: "915", holder: Number.NaN } }), {
    fdv: null,
    volumeUsd: null,
    holders: null,
  });
  assert.equal(formatUsd(null), "—");
  assert.equal(formatCount(null), "—");
  assert.equal(formatAge("not-a-date", 0), "—");
  assert.equal(formatAge("2026-10-22T16:00:00.000Z", Date.parse("2026-10-22T16:42:00.000Z")), "42m");
  assert.equal(formatAge("2026-10-10T16:00:00.000Z", Date.parse("2026-10-22T16:00:00.000Z")), "12d");
});
