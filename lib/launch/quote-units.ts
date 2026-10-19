// Exact base-unit conversion for a $SDK-denominated developer buy. No floating point.

const AMOUNT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$/;
const U64 = BigInt("18446744073709551615");

export function quoteBaseUnits(
  amount: string,
  decimals: number,
): { ok: true; baseUnits: string } | { ok: false; code: "buy" | "decimals" } {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    return { ok: false, code: "decimals" };
  }
  if (!AMOUNT.test(amount)) return { ok: false, code: "buy" };
  const [whole, fraction = ""] = amount.split(".");
  if (!whole) return { ok: false, code: "buy" };
  if (fraction.length > decimals) return { ok: false, code: "buy" };
  const digits = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  const units = BigInt(digits);
  if (units > U64) return { ok: false, code: "buy" };
  return { ok: true, baseUnits: units.toString() };
}
