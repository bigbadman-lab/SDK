import type { RewardScope } from "./ledger.ts";
import { MIN_HOLDER_WHOLE_TOKENS } from "./holders.ts";

export type RewardActivity = {
  asset: "sol" | "parent_token";
  status: "allocated" | "claimable" | "pending" | "paid" | "failed" | "uncertain";
  amount: string;
  signature: string | null;
};

export type AccountRewardsView = {
  scope: RewardScope;
  symbol: "SDK" | "TREST" | null;
  ledger: "missing" | "ready";
  custody: string;
  claimableSol: string;
  claimableToken: string;
  pendingSol: string;
  pendingToken: string;
  paidSol: string;
  paidToken: string;
  eligible: boolean | null;
  snapshotBalance: string | null;
  currentBalance: string | null;
  minimumWholeTokens: number;
  lastWindow: string | null;
  activity: RewardActivity[];
  earnings: { role: "launcher" | "developer"; scope: RewardScope; mint: string; amount: string; signature: string | null }[];
  execution: "unavailable";
  executionReason: string;
};

const CUSTODY =
  "Unclaimed rewards stay in the parent deployer wallet. This page shows accounting entitlements. It is not an on-chain escrow balance.";

const PENDING = new Set(["reserved", "recorded", "submitted", "uncertain", "unreconciled"]);

export function rewardsView(input: {
  scope: RewardScope;
  symbol: "SDK" | "TREST" | null;
  ledger: "missing" | "ready";
  executionReason: string;
  snapshots: readonly { owner: string; balance: string; solLamports: string; tokenAmount: string; windowKey: string }[];
  claims: readonly { asset: "sol" | "trest"; amount: string; status: string; signature: string | null }[];
  windows: readonly { windowKey: string }[];
  wallet: string;
  threshold: string | null;
  currentBalance: string | null;
  earnings: AccountRewardsView["earnings"];
}): AccountRewardsView {
  const own = input.snapshots.filter((row) => row.owner === input.wallet);
  let allocatedSol = BigInt(0);
  let allocatedToken = BigInt(0);
  let latestBalance: string | null = null;
  let lastWindow: string | null = null;
  for (const row of own) {
    allocatedSol += BigInt(row.solLamports);
    allocatedToken += BigInt(row.tokenAmount);
    latestBalance = row.balance;
    if (!lastWindow || row.windowKey > lastWindow) lastWindow = row.windowKey;
  }
  let pendingSol = BigInt(0);
  let pendingToken = BigInt(0);
  let paidSol = BigInt(0);
  let paidToken = BigInt(0);
  const activity: RewardActivity[] = [];
  for (const claim of input.claims) {
    const token = claim.asset === "trest";
    const bucket = token ? "token" : "sol";
    if (claim.status === "confirmed") {
      if (bucket === "sol") paidSol += BigInt(claim.amount);
      else paidToken += BigInt(claim.amount);
      activity.push({ asset: token ? "parent_token" : "sol", status: "paid", amount: claim.amount, signature: claim.signature });
    } else if (PENDING.has(claim.status)) {
      if (bucket === "sol") pendingSol += BigInt(claim.amount);
      else pendingToken += BigInt(claim.amount);
      activity.push({
        asset: token ? "parent_token" : "sol",
        status: claim.status === "uncertain" || claim.status === "unreconciled" ? "uncertain" : "pending",
        amount: claim.amount,
        signature: claim.signature,
      });
    } else if (claim.status === "failed") {
      activity.push({ asset: token ? "parent_token" : "sol", status: "failed", amount: claim.amount, signature: claim.signature });
    }
  }
  const claimableSol = allocatedSol - pendingSol - paidSol;
  const claimableToken = allocatedToken - pendingToken - paidToken;
  const eligible =
    input.threshold === null || latestBalance === null ? null : BigInt(latestBalance) >= BigInt(input.threshold);
  if (input.windows.length > 0) {
    const newest = [...input.windows].sort((left, right) => (left.windowKey < right.windowKey ? 1 : -1))[0];
    if (newest) lastWindow = newest.windowKey;
  }
  return {
    scope: input.scope,
    symbol: input.symbol,
    ledger: input.ledger,
    custody: CUSTODY,
    claimableSol: (claimableSol > BigInt(0) ? claimableSol : BigInt(0)).toString(),
    claimableToken: (claimableToken > BigInt(0) ? claimableToken : BigInt(0)).toString(),
    pendingSol: pendingSol.toString(),
    pendingToken: pendingToken.toString(),
    paidSol: paidSol.toString(),
    paidToken: paidToken.toString(),
    eligible,
    snapshotBalance: latestBalance,
    currentBalance: input.currentBalance,
    minimumWholeTokens: MIN_HOLDER_WHOLE_TOKENS,
    lastWindow,
    activity,
    earnings: input.earnings.filter((row) => row.scope === input.scope),
    execution: "unavailable",
    executionReason: input.executionReason,
  };
}

export function claimAllResults(
  results: readonly { asset: "sol" | "parent_token"; ok: boolean; code: string }[],
): { outcome: "confirmed" | "failed" | "partial" | "unavailable"; results: typeof results } {
  if (results.length !== 2) return { outcome: "failed", results };
  const ok = results.filter((result) => result.ok).length;
  if (ok === 2) return { outcome: "confirmed", results };
  if (ok === 0) {
    return { outcome: results.every((result) => result.code === "unavailable") ? "unavailable" : "failed", results };
  }
  return { outcome: "partial", results };
}

export function isolatedProduction(view: AccountRewardsView): boolean {
  return view.scope === "production" && view.symbol !== "TREST";
}
