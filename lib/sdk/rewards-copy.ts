import { MIN_HOLDER_WHOLE_TOKENS } from "../rewards/holders.ts";
import { splitCreatorFees, WINDOW_MS } from "../rewards/ledger.ts";

export function nativeRewardSplit(): { holders: string; buyback: string; deployer: string } | null {
  const split = splitCreatorFees("100");
  if (!split.ok) return null;
  if (BigInt(split.holders) + BigInt(split.buyback) + BigInt(split.deployer) !== BigInt(100)) return null;
  return { holders: split.holders, buyback: split.buyback, deployer: split.deployer };
}

export function holderMinimumLabel(): string {
  return String(MIN_HOLDER_WHOLE_TOKENS).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function windowLengthLabel(): string {
  const minutes = WINDOW_MS / 60_000;
  return Number.isInteger(minutes) ? String(minutes) : "";
}
