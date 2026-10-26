import { allocateCreatorFees, PLATFORM_FEE_WALLET, type FeeCategory, type Shareholder } from "../launch/fees.ts";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "./collect.ts";

export const DISTRIBUTE_CREATOR_FEES_V2 = [255, 203, 19, 79, 244, 68, 8, 159];
export const SWEEP_CREATOR_FEE = [32, 246, 191, 52, 8, 201, 73, 186];
export const TRANSFER_CREATOR_FEES_TO_PUMP_V2 = [1, 33, 78, 185, 33, 67, 44, 92];
export { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID };
const NATIVE_COLLECT_V2 = [207, 17, 138, 242, 4, 34, 19, 56];
const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

export type ObservedShare = { address: string; shareBps: number };

function sameShares(left: readonly Shareholder[], right: readonly ObservedShare[]): boolean {
  const normal = (rows: readonly ObservedShare[]) =>
    [...rows]
      .map((row) => `${row.address}:${row.shareBps}`)
      .sort()
      .join(",");
  return normal(left) === normal(right);
}

export function verifyChildSharing(input: {
  category: FeeCategory;
  launcherWallet: string;
  originatorWallet: string | null;
  observed: readonly ObservedShare[];
  adminRevoked: boolean;
}): { ok: true; shareholders: Shareholder[] } | { ok: false; code: "allocation" | "revocation" | "shareholders" } {
  if (!input.adminRevoked) return { ok: false, code: "revocation" };
  const expected = allocateCreatorFees({
    category: input.category,
    launcherWallet: input.launcherWallet,
    originatorWallet: input.originatorWallet,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  if (!expected.ok) return { ok: false, code: "allocation" };
  if (!sameShares(expected.shareholders, input.observed)) return { ok: false, code: "shareholders" };
  return { ok: true, shareholders: expected.shareholders };
}

export function splitChildFee(
  amount: string,
  shareholders: readonly Shareholder[],
): { ok: true; shares: { address: string; amount: string }[] } | { ok: false; code: "amount" | "allocation" } {
  if (!AMOUNT.test(amount)) return { ok: false, code: "amount" };
  const total = BigInt(amount);
  if (shareholders.length < 1 || shareholders.reduce((sum, row) => sum + row.shareBps, 0) !== 10_000) {
    return { ok: false, code: "allocation" };
  }
  let spent = BigInt(0);
  const shares = shareholders.map((row) => {
    const share = (total * BigInt(row.shareBps)) / BigInt(10_000);
    spent += share;
    return { address: row.address, amount: share.toString() };
  });
  const remainder = total - spent;
  const platform = shares.find((row) => row.address === PLATFORM_FEE_WALLET);
  const target = platform ?? shares[shares.length - 1];
  if (!target) return { ok: false, code: "allocation" };
  if (remainder > BigInt(0)) target.amount = (BigInt(target.amount) + remainder).toString();
  return { ok: true, shares };
}

export function nativeCollectionInstruction(data: readonly number[]): boolean {
  return NATIVE_COLLECT_V2.every((byte, index) => data[index] === byte);
}

export function childDistributionInstruction(data: readonly number[]): boolean {
  return DISTRIBUTE_CREATOR_FEES_V2.every((byte, index) => data[index] === byte);
}

export function pumpCreatorFeeDistribution(programId: string, data: readonly number[]): boolean {
  return programId === PUMP_PROGRAM_ID && childDistributionInstruction(data);
}

export function pumpFlooredShares(
  balance: bigint,
  shareholders: readonly Shareholder[],
): { address: string; amount: bigint }[] | null {
  if (balance < BigInt(0) || shareholders.length < 1 || shareholders.length > 10) return null;
  if (shareholders.reduce((sum, row) => sum + row.shareBps, 0) !== 10_000) return null;
  if (shareholders.some((row) => !Number.isInteger(row.shareBps) || row.shareBps <= 0)) return null;
  const seen = new Set<string>();
  const shares = [];
  for (const row of shareholders) {
    if (seen.has(row.address)) return null;
    seen.add(row.address);
    shares.push({ address: row.address, amount: (balance * BigInt(row.shareBps)) / BigInt(10_000) });
  }
  return shares;
}

// Pump floors each shareholder independently against the pre-distribution vault
// balance. The unpaid remainder stays in the vault and is below the shareholder count.
export function matchShareholderReceipts(input: {
  quoteMint: string;
  shareholders: readonly Shareholder[];
  distributed: string;
  deltas: readonly { owner: string; mint: string; amount: string; sign?: "credit" | "debit" }[];
}): { ok: true; receipts: { address: string; amount: string }[] } | { ok: false; code: "unconfirmed" } {
  if (!AMOUNT.test(input.distributed)) return { ok: false, code: "unconfirmed" };
  if (input.deltas.some((row) => row.mint !== input.quoteMint)) return { ok: false, code: "unconfirmed" };
  const holders = new Set(input.shareholders.map((row) => row.address));
  if (holders.size !== input.shareholders.length) return { ok: false, code: "unconfirmed" };
  const debits = input.deltas.filter((row) => row.sign === "debit");
  const credits = input.deltas.filter((row) => row.sign === "credit");
  if (debits.length !== 1 || credits.length !== input.deltas.length - 1) return { ok: false, code: "unconfirmed" };
  const debit = debits[0];
  if (!debit || holders.has(debit.owner) || !AMOUNT.test(debit.amount)) return { ok: false, code: "unconfirmed" };
  const paid = new Map<string, bigint>();
  let creditSum = BigInt(0);
  for (const credit of credits) {
    if (!holders.has(credit.owner) || paid.has(credit.owner) || !AMOUNT.test(credit.amount)) return { ok: false, code: "unconfirmed" };
    const amount = BigInt(credit.amount);
    paid.set(credit.owner, amount);
    creditSum += amount;
  }
  const distributed = BigInt(debit.amount);
  if (creditSum !== distributed || distributed !== BigInt(input.distributed)) return { ok: false, code: "unconfirmed" };
  for (let dust = BigInt(0); dust < BigInt(input.shareholders.length); dust += BigInt(1)) {
    const shares = pumpFlooredShares(distributed + dust, input.shareholders);
    if (!shares) return { ok: false, code: "unconfirmed" };
    const floored = shares.reduce((sum, share) => sum + share.amount, BigInt(0));
    const exact = floored === distributed && shares.every((share) => (paid.get(share.address) ?? BigInt(0)) === share.amount);
    if (!exact) continue;
    const receipts = shares.filter((share) => share.amount > BigInt(0)).map((share) => ({ address: share.address, amount: share.amount.toString() }));
    if (receipts.length === 0 || receipts.length !== paid.size) return { ok: false, code: "unconfirmed" };
    return { ok: true, receipts };
  }
  return { ok: false, code: "unconfirmed" };
}
