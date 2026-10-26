import { explorerUrl, formatVerifiedAt, shortenAddress } from "../launch/verified-launch.ts";
import { formatTokenBalance } from "../sdk/official.ts";
import type { CreatorEarning } from "./account-view.ts";

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CHILD_SYMBOL = /^[A-Za-z0-9]{1,13}$/;

export type CreatorReceiptDisplay = {
  headline: string;
  childLabel: string | null;
  status: "Confirmed";
  receivedAt: string | null;
  explorerUrl: string;
};

function decimalsOf(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 9) return null;
  return value;
}

function quoteLabel(row: CreatorEarning): string {
  if (row.quoteSymbol === "SDK" || row.quoteSymbol === "TREST") return row.quoteSymbol;
  return shortenAddress(row.mint);
}

export function presentCreatorReceipt(row: CreatorEarning): CreatorReceiptDisplay | null {
  if (!row.signature || !SIGNATURE.test(row.signature) || !AMOUNT.test(row.amount) || row.amount === "0") return null;
  const decimals = decimalsOf(row.quoteDecimals);
  const formatted = decimals === null ? null : formatTokenBalance(row.amount, decimals);
  const quote = quoteLabel(row);
  const headline = formatted && formatted !== "—" ? `${formatted} ${quote}` : `${row.amount} base units of ${quote}`;
  const childSymbol = row.childSymbol && CHILD_SYMBOL.test(row.childSymbol) ? row.childSymbol : null;
  const childMint = row.childMint && row.childMint.length >= 32 ? shortenAddress(row.childMint) : null;
  const received = row.receivedAt ? new Date(row.receivedAt) : null;
  return {
    headline,
    childLabel: childSymbol ? `Creator fees from $${childSymbol}` : childMint ? `Creator fees from ${childMint}` : null,
    status: "Confirmed",
    receivedAt: received && !Number.isNaN(received.getTime()) ? formatVerifiedAt(received.toISOString()) : null,
    explorerUrl: explorerUrl(row.signature, "tx"),
  };
}
