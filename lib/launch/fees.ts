// Trusted creator-fee allocation. Recipients and percentages never come from a request.

export const PLATFORM_FEE_WALLET = "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type FeeCategory = "community_split" | "originator_launch" | "official";

export type Shareholder = {
  address: string;
  shareBps: number;
};

export type FeeAllocation =
  | { ok: true; shareholders: Shareholder[] }
  | { ok: false; code: "wallet" | "platform_wallet" | "lineage" | "allocation" };

function address(value: string | null | undefined): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

function merge(parts: Shareholder[]): Shareholder[] | null {
  const totals = new Map<string, number>();
  for (const part of parts) {
    if (!address(part.address) || !Number.isInteger(part.shareBps) || part.shareBps <= 0) {
      return null;
    }
    totals.set(part.address, (totals.get(part.address) ?? 0) + part.shareBps);
  }
  const shareholders = [...totals.entries()]
    .map(([holder, shareBps]) => ({ address: holder, shareBps }))
    .sort((left, right) => (left.address < right.address ? -1 : 1));
  const total = shareholders.reduce((sum, holder) => sum + holder.shareBps, 0);
  if (shareholders.length < 1 || shareholders.length > 10 || total !== 10_000) return null;
  if (shareholders.some((holder) => holder.shareBps <= 0)) return null;
  return shareholders;
}

export function allocateCreatorFees(input: {
  category: FeeCategory;
  launcherWallet: string;
  originatorWallet: string | null;
  platformWallet: string;
}): FeeAllocation {
  if (input.platformWallet !== PLATFORM_FEE_WALLET) {
    return { ok: false, code: "platform_wallet" };
  }
  if (!address(input.launcherWallet) || !address(input.platformWallet)) {
    return { ok: false, code: "wallet" };
  }
  const launcher = input.launcherWallet;
  const platform = input.platformWallet;
  let parts: Shareholder[];
  if (input.category === "official") {
    parts = [
      { address: launcher, shareBps: 6000 },
      { address: platform, shareBps: 4000 },
    ];
  } else if (input.category === "originator_launch") {
    if (input.originatorWallet !== null && input.originatorWallet !== launcher) {
      return { ok: false, code: "lineage" };
    }
    if (input.originatorWallet !== null && !address(input.originatorWallet)) {
      return { ok: false, code: "wallet" };
    }
    parts = [
      { address: launcher, shareBps: 8500 },
      { address: platform, shareBps: 1500 },
    ];
  } else if (input.category === "community_split") {
    if (!address(input.originatorWallet)) return { ok: false, code: "lineage" };
    parts = [
      { address: launcher, shareBps: 6000 },
      { address: input.originatorWallet, shareBps: 2500 },
      { address: platform, shareBps: 1500 },
    ];
  } else {
    return { ok: false, code: "lineage" };
  }
  const shareholders = merge(parts);
  if (!shareholders) return { ok: false, code: "allocation" };
  return { ok: true, shareholders };
}
