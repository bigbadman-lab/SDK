import { canonicalAddress } from "../auth/solana.ts";

// Balances are a confirmed observation of current token accounts.
// getProgramAccounts cannot reconstruct balances at an earlier slot, so the
// stored cutoff is the slot returned with that same read. It is not a
// historical snapshot. Multiple token accounts for one owner are summed
// before the 50,000-token threshold. Excluded owners and other mints are
// ignored. Shares use integer division and the remainder stays unallocated.
// A failed or rate-limited read returns no snapshot and credits nothing.

export const MIN_HOLDER_WHOLE_TOKENS = 50_000;

export type HolderAccount = {
  owner: string;
  mint: string;
  amount: string;
};

export type HolderShare = {
  owner: string;
  balance: string;
  solLamports: string;
  tokenAmount: string;
};

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

function parse(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

export function holderThreshold(decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) return null;
  let unit = BigInt(1);
  for (let index = 0; index < decimals; index += 1) unit *= BigInt(10);
  return (BigInt(MIN_HOLDER_WHOLE_TOKENS) * unit).toString();
}

export function snapshotHolders(input: {
  parentMint: string;
  decimals: number;
  accounts: readonly HolderAccount[];
  excludedOwners: readonly string[];
  solLamports: string;
  tokenAmount: string;
}): { ok: true; holders: HolderShare[]; unallocatedSol: string; unallocatedToken: string } | { ok: false; code: "amount" | "parent" } {
  const parent = canonicalAddress(input.parentMint);
  const threshold = holderThreshold(input.decimals);
  const sol = parse(input.solLamports);
  const tokens = parse(input.tokenAmount);
  const minimum = threshold === null ? null : parse(threshold);
  if (!parent || minimum === null || sol === null || tokens === null) return { ok: false, code: "parent" };
  const excluded = new Set(
    input.excludedOwners.flatMap((owner) => {
      const address = canonicalAddress(owner);
      return address ? [address] : [];
    }),
  );
  const balances = new Map<string, bigint>();
  for (const account of input.accounts) {
    const owner = canonicalAddress(account.owner);
    const mint = canonicalAddress(account.mint);
    const amount = parse(account.amount);
    if (!owner || !mint || amount === null) return { ok: false, code: "amount" };
    if (mint !== parent || excluded.has(owner) || amount <= BigInt(0)) continue;
    balances.set(owner, (balances.get(owner) ?? BigInt(0)) + amount);
  }
  const eligible = [...balances.entries()]
    .filter(([, balance]) => balance >= minimum)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const total = eligible.reduce((sum, [, balance]) => sum + balance, BigInt(0));
  if (total <= BigInt(0)) {
    return {
      ok: true,
      holders: [],
      unallocatedSol: sol.toString(),
      unallocatedToken: tokens.toString(),
    };
  }
  let spentSol = BigInt(0);
  let spentToken = BigInt(0);
  const holders = eligible.map(([owner, balance]) => {
    const solShare = (sol * balance) / total;
    const tokenShare = (tokens * balance) / total;
    spentSol += solShare;
    spentToken += tokenShare;
    return {
      owner,
      balance: balance.toString(),
      solLamports: solShare.toString(),
      tokenAmount: tokenShare.toString(),
    };
  });
  return {
    ok: true,
    holders,
    unallocatedSol: (sol - spentSol).toString(),
    unallocatedToken: (tokens - spentToken).toString(),
  };
}
