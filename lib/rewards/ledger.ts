import { canonicalAddress } from "../auth/solana.ts";

export const WINDOW_MS = 5 * 60 * 1000;

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

export type RewardScope = "production" | "test";

export type FeeReceipt = {
  signature: string;
  parentMint: string;
  scope: RewardScope;
  amountLamports: string;
  slot: string;
  confirmed: boolean;
  source: "creator_vault" | "wallet_deposit";
};

export type FeeCreditCode = "amount" | "duplicate" | "fee_source" | "parent" | "unconfirmed";

function parseAmount(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

export function splitCreatorFees(
  amountLamports: string,
): { ok: true; holders: string; buyback: string; deployer: string } | { ok: false; code: "amount" } {
  const amount = parseAmount(amountLamports);
  if (amount === null) return { ok: false, code: "amount" };
  const holders = (amount * BigInt(30)) / BigInt(100);
  const buyback = (amount * BigInt(30)) / BigInt(100);
  const deployer = amount - holders - buyback;
  return { ok: true, holders: holders.toString(), buyback: buyback.toString(), deployer: deployer.toString() };
}

export function accountingWindow(timestampMs: number): { startMs: number; endMs: number } | null {
  if (!Number.isInteger(timestampMs) || timestampMs < 0) return null;
  const startMs = timestampMs - (timestampMs % WINDOW_MS);
  return { startMs, endMs: startMs + WINDOW_MS };
}

export function creditFee(
  existing: readonly FeeReceipt[],
  next: FeeReceipt,
): { ok: true; receipts: FeeReceipt[] } | { ok: false; code: FeeCreditCode } {
  if (!parseAmount(next.amountLamports) || BigInt(next.amountLamports) <= BigInt(0)) {
    return { ok: false, code: "amount" };
  }
  if (!canonicalAddress(next.parentMint) || !AMOUNT.test(next.slot)) return { ok: false, code: "parent" };
  if (!next.confirmed) return { ok: false, code: "unconfirmed" };
  if (next.source !== "creator_vault") return { ok: false, code: "fee_source" };
  if (existing.some((receipt) => receipt.signature === next.signature)) {
    return { ok: false, code: "duplicate" };
  }
  return { ok: true, receipts: [...existing, next] };
}

export function creditedLamports(receipts: readonly FeeReceipt[], parentMint: string, scope: RewardScope): string {
  return receipts
    .reduce((total, receipt) => {
      if (receipt.parentMint !== parentMint || receipt.scope !== scope) return total;
      if (!receipt.confirmed || receipt.source !== "creator_vault") return total;
      const amount = parseAmount(receipt.amountLamports);
      return amount === null ? total : total + amount;
    }, BigInt(0))
    .toString();
}

// The reserve is a standing solvency floor against lifetime creator fees.
// It is withheld once. Later windows pass the amount already withheld and do not
// subtract the full reserve again.
export function planIncrementalAllocation(input: {
  grossLamports: string;
  reserveLamports: string;
  reserveWithheldLamports: string;
}): { ok: true; withheld: string; base: string; holders: string; buyback: string; deployer: string } | { ok: false; code: "amount" } {
  const gross = parseAmount(input.grossLamports);
  const reserve = parseAmount(input.reserveLamports);
  const withheldAlready = parseAmount(input.reserveWithheldLamports);
  if (gross === null || reserve === null || withheldAlready === null || withheldAlready > reserve) {
    return { ok: false, code: "amount" };
  }
  const remaining = reserve - withheldAlready;
  const withheld = gross < remaining ? gross : remaining;
  const base = gross - withheld;
  if (base === BigInt(0)) {
    return { ok: true, withheld: withheld.toString(), base: "0", holders: "0", buyback: "0", deployer: "0" };
  }
  const split = splitCreatorFees(base.toString());
  if (!split.ok) return split;
  return { ok: true, withheld: withheld.toString(), base: base.toString(), holders: split.holders, buyback: split.buyback, deployer: split.deployer };
}

export function buybackSpendAllowed(input: {
  walletLamports: string;
  buybackLamports: string;
  reserveLamports: string;
  unpaidHolderLamports: string;
  deployerRetainedLamports: string;
  unspentPriorBuybackLamports: string;
  deferredHolderLamports: string;
  deferredBuybackLamports: string;
  deferredDeployerLamports: string;
}): { ok: true } | { ok: false; code: "amount" | "unfunded" } {
  const wallet = parseAmount(input.walletLamports);
  const buyback = parseAmount(input.buybackLamports);
  const reserve = parseAmount(input.reserveLamports);
  const holders = parseAmount(input.unpaidHolderLamports);
  const deployer = parseAmount(input.deployerRetainedLamports);
  const prior = parseAmount(input.unspentPriorBuybackLamports);
  const deferredHolders = parseAmount(input.deferredHolderLamports);
  const deferredBuyback = parseAmount(input.deferredBuybackLamports);
  const deferredDeployer = parseAmount(input.deferredDeployerLamports);
  if (
    wallet === null || buyback === null || reserve === null || holders === null || deployer === null || prior === null
    || deferredHolders === null || deferredBuyback === null || deferredDeployer === null
  ) {
    return { ok: false, code: "amount" };
  }
  if (buyback <= BigInt(0) || wallet < BigInt(0)) return { ok: false, code: "amount" };
  if (wallet < buyback + reserve + holders + deployer + prior + deferredHolders + deferredBuyback + deferredDeployer) {
    return { ok: false, code: "unfunded" };
  }
  return { ok: true };
}

export function rewardBase(credited: string, reserveLamports: string): { ok: true; base: string } | { ok: false; code: "amount" } {
  const collected = parseAmount(credited);
  const reserve = parseAmount(reserveLamports);
  if (collected === null || reserve === null) return { ok: false, code: "amount" };
  const base = collected > reserve ? collected - reserve : BigInt(0);
  return { ok: true, base: base.toString() };
}

export function authoriseBucketSpend(input: {
  bucket: "holders" | "buyback";
  creditedLamports: string;
  reserveLamports: string;
  bucketSpentLamports: string;
  amountLamports: string;
  cycleSpentLamports: string;
  cycleCapLamports: string;
  slippageBps: number;
  destination: string;
  allowedDestinations: readonly string[];
  programs: readonly string[];
  allowedPrograms: readonly string[];
  suspended: boolean;
  walletLamports: string;
}): { ok: true } | { ok: false; code: "amount" | "cycle" | "destination" | "program" | "slippage" | "suspended" | "unfunded" } {
  if (input.suspended) return { ok: false, code: "suspended" };
  if (
    input.bucket === "buyback" &&
    (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 1000)
  ) {
    return { ok: false, code: "slippage" };
  }
  const amount = parseAmount(input.amountLamports);
  const spent = parseAmount(input.bucketSpentLamports);
  const cycleSpent = parseAmount(input.cycleSpentLamports);
  const cycleCap = parseAmount(input.cycleCapLamports);
  const wallet = parseAmount(input.walletLamports);
  if (amount === null || spent === null || cycleSpent === null || cycleCap === null || wallet === null || wallet < BigInt(0)) {
    return { ok: false, code: "amount" };
  }
  if (amount <= BigInt(0)) return { ok: false, code: "amount" };
  const destination = canonicalAddress(input.destination);
  const allowedDestinations = input.allowedDestinations.map((value) => canonicalAddress(value));
  if (!destination || allowedDestinations.some((value) => value === null) || !allowedDestinations.includes(destination)) {
    return { ok: false, code: "destination" };
  }
  if (input.programs.length === 0) return { ok: false, code: "program" };
  const allowedPrograms = new Set(
    input.allowedPrograms.flatMap((value) => {
      const address = canonicalAddress(value);
      return address ? [address] : [];
    }),
  );
  for (const program of input.programs) {
    const address = canonicalAddress(program);
    if (!address || !allowedPrograms.has(address)) return { ok: false, code: "program" };
  }
  const base = rewardBase(input.creditedLamports, input.reserveLamports);
  if (!base.ok) return { ok: false, code: "amount" };
  const split = splitCreatorFees(base.base);
  if (!split.ok) return { ok: false, code: "amount" };
  const bucketTotal = BigInt(input.bucket === "holders" ? split.holders : split.buyback);
  if (spent + amount > bucketTotal) return { ok: false, code: "unfunded" };
  if (cycleSpent + amount > cycleCap) return { ok: false, code: "cycle" };
  return { ok: true };
}

export function retainedDeployerLamports(
  creditedLamports: string,
  reserveLamports: string,
): { ok: true; retained: string; spendable: "0" } | { ok: false; code: "amount" } {
  const base = rewardBase(creditedLamports, reserveLamports);
  if (!base.ok) return base;
  const split = splitCreatorFees(base.base);
  if (!split.ok) return split;
  return { ok: true, retained: split.deployer, spendable: "0" };
}

export function acceptWindow(existing: readonly string[], key: string): { ok: true } | { ok: false; code: "duplicate" } {
  if (existing.includes(key)) return { ok: false, code: "duplicate" };
  return { ok: true };
}
