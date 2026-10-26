import type { RewardScope } from "./ledger.ts";
import { MIN_HOLDER_WHOLE_TOKENS } from "./holders.ts";

export type RewardActivity = {
  asset: "sol" | "parent_token";
  status: "allocated" | "claimable" | "pending" | "paid" | "failed" | "uncertain";
  amount: string;
  signature: string | null;
};

export type CreatorEarning = {
  role: "launcher" | "developer";
  scope: RewardScope;
  mint: string;
  amount: string;
  signature: string | null;
  childMint?: string | null;
  quoteSymbol?: "SDK" | "TREST" | null;
  quoteDecimals?: number | null;
  childSymbol?: string | null;
  receivedAt?: string | null;
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
  earnings: CreatorEarning[];
  execution: "ready" | "suspended" | "reconciling" | "confirming" | "confirmed" | "failed" | "empty" | "unreadable";
  executionReason: string;
};

const CUSTODY =
  "Unclaimed rewards stay in the parent deployer wallet. This page shows accounting entitlements. It is not an on-chain escrow balance.";

const PENDING = new Set(["reserved", "recorded", "submitted", "uncertain", "unreconciled"]);

const CLAIM_AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

function claimAmount(value: string): bigint {
  return CLAIM_AMOUNT.test(value) ? BigInt(value) : BigInt(0);
}

export function rewardStatus(input: {
  ledger: "missing" | "ready";
  worker: "ready" | "suspended" | "unknown";
  claimableSol: string;
  claimableToken: string;
  pendingSol: string;
  pendingToken: string;
  paidSol: string;
  paidToken: string;
  activity: readonly { status: RewardActivity["status"] }[];
}): { execution: AccountRewardsView["execution"]; executionReason: string } {
  if (input.ledger === "missing") {
    return { execution: "unreadable", executionReason: "The rewards ledger is unavailable." };
  }
  if (input.activity.some((item) => item.status === "uncertain")) {
    return {
      execution: "reconciling",
      executionReason: "A claim is awaiting reconciliation. An uncertain ledger row does not show whether the transfer has already landed.",
    };
  }
  if (claimAmount(input.pendingSol) > BigInt(0) || claimAmount(input.pendingToken) > BigInt(0)) {
    return { execution: "confirming", executionReason: "A claim has been submitted and is awaiting confirmation." };
  }
  if (input.worker === "suspended") {
    return { execution: "suspended", executionReason: "Rewards execution is suspended. Signing a claim does not move funds." };
  }
  if (input.activity.some((item) => item.status === "failed") && claimAmount(input.claimableSol) === BigInt(0) && claimAmount(input.claimableToken) === BigInt(0) && claimAmount(input.paidSol) === BigInt(0) && claimAmount(input.paidToken) === BigInt(0)) {
    return { execution: "failed", executionReason: "The claim failed. No confirmed transfer is recorded." };
  }
  if (claimAmount(input.claimableSol) > BigInt(0) || claimAmount(input.claimableToken) > BigInt(0)) {
    if (input.worker !== "ready") {
      return {
        execution: "unreadable",
        executionReason: "A claimable balance is recorded. Worker authorisation was not confirmed from this page.",
      };
    }
    const sol = claimAmount(input.claimableSol) > BigInt(0);
    const token = claimAmount(input.claimableToken) > BigInt(0);
    return {
      execution: "ready",
      executionReason: sol && token
        ? "SOL and parent-token rewards are ready to claim."
        : token
          ? "Parent-token rewards are ready to claim."
          : "SOL is ready to claim.",
    };
  }
  if (claimAmount(input.paidSol) > BigInt(0) || claimAmount(input.paidToken) > BigInt(0)) {
    return { execution: "confirmed", executionReason: "The claim was confirmed." };
  }
  return { execution: "empty", executionReason: "No claimable entitlement." };
}

export function rewardsView(input: {
  scope: RewardScope;
  symbol: "SDK" | "TREST" | null;
  ledger: "missing" | "ready";
  worker?: "ready" | "suspended" | "unknown";
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
  const claimableSol = (allocatedSol - pendingSol - paidSol > BigInt(0) ? allocatedSol - pendingSol - paidSol : BigInt(0)).toString();
  const claimableToken = (allocatedToken - pendingToken - paidToken > BigInt(0) ? allocatedToken - pendingToken - paidToken : BigInt(0)).toString();
  const eligible =
    input.threshold === null || latestBalance === null ? null : BigInt(latestBalance) >= BigInt(input.threshold);
  if (input.windows.length > 0) {
    const newest = [...input.windows].sort((left, right) => (left.windowKey < right.windowKey ? 1 : -1))[0];
    if (newest) lastWindow = newest.windowKey;
  }
  const status = rewardStatus({
    ledger: input.ledger,
    worker: input.worker ?? "unknown",
    claimableSol,
    claimableToken,
    pendingSol: pendingSol.toString(),
    pendingToken: pendingToken.toString(),
    paidSol: paidSol.toString(),
    paidToken: paidToken.toString(),
    activity,
  });
  return {
    scope: input.scope,
    symbol: input.symbol,
    ledger: input.ledger,
    custody: CUSTODY,
    claimableSol,
    claimableToken,
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
    execution: status.execution,
    executionReason: status.executionReason,
  };
}

export function claimAllPlan(input: { claimableSol: string; claimableToken: string }): ("sol" | "parent_token")[] {
  const assets: ("sol" | "parent_token")[] = [];
  if (claimAmount(input.claimableSol) > BigInt(0)) assets.push("sol");
  if (claimAmount(input.claimableToken) > BigInt(0)) assets.push("parent_token");
  return assets;
}

export function claimAllResults(
  results: readonly { asset: "sol" | "parent_token"; ok: boolean; code: string }[],
): { outcome: "confirmed" | "failed" | "partial" | "unavailable"; results: typeof results } {
  if (results.length === 0) return { outcome: "failed", results };
  const ok = results.filter((result) => result.ok).length;
  if (ok === results.length) return { outcome: "confirmed", results };
  if (ok === 0) {
    return { outcome: results.every((result) => result.code === "unavailable") ? "unavailable" : "failed", results };
  }
  return { outcome: "partial", results };
}

export function isolatedProduction(view: AccountRewardsView): boolean {
  return view.scope === "production" && view.symbol !== "TREST";
}
