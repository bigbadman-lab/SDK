// Pump SDK 4.2.0 treats buy slippage as a percent:
// minOut = amount - amount * floor(percent * 10) / 1000.
// 100 basis points is 1 percent. Passing the raw basis-point integer is a 100% bound.

export function slippagePercent(
  bps: number,
): { ok: true; percent: number } | { ok: false; code: "slippage" } {
  if (!Number.isInteger(bps) || bps < 10 || bps > 1000 || bps % 10 !== 0) {
    return { ok: false, code: "slippage" };
  }
  return { ok: true, percent: bps / 100 };
}
