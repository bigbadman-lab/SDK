import { TREST_MINT } from "../launch/verified-launch.ts";
import { PLATFORM_FEE_WALLET, type FeeCategory } from "../launch/fees.ts";
import { canonicalAddress } from "../auth/solana.ts";

export const CHILD_FEE_BATCH = 8;
export const VENT_MINT = "7Rrmq49nP4pFckExFxybJuqFwQbiKeGedbD22w5twvQB";
export const DNA_MINT = "7FsscnVKPLJxHpncZvG3nT9vzoeKKYULKTwrxvtF36gP";

const HISTORICAL = new Set([TREST_MINT, VENT_MINT, DNA_MINT]);
const CATEGORIES = new Set<FeeCategory>(["official", "originator_launch", "community_split"]);
const VERIFIED = new Set(["verified", "page_ready"]);

export type ProductionChildRow = {
  mint: string | null;
  quoteMint: string | null;
  buildQuote: string | null;
  scope: string | null;
  category: string | null;
  launcher: string | null;
  originator: string | null;
  attemptStatus: string | null;
  submissionStatus: string | null;
};

export type AcceptedProductionChild = {
  mint: string;
  quoteMint: string;
  scope: "production";
  category: FeeCategory;
  launcher: string;
  originator: string | null;
};

function addressOf(value: string | null | undefined): string | null {
  if (!value) return null;
  return canonicalAddress(value);
}

export function productionChildFeeControl(input: {
  canonicalMint: string | null;
  childFeesActive: boolean;
  launchesActive: boolean;
  rewardsActive: boolean;
  executionAuthorised: boolean;
  signerMatched: boolean;
  suspended: boolean;
  emergencyFence: boolean;
  shuttingDown: boolean;
}): { reconcile: boolean; distribute: boolean } {
  const mint = addressOf(input.canonicalMint);
  const registered = mint !== null && mint !== TREST_MINT;
  if (!registered) return { reconcile: false, distribute: false };
  const distribute = input.childFeesActive === true
    && input.executionAuthorised === true
    && input.signerMatched === true
    && input.suspended !== true
    && input.emergencyFence !== true
    && input.shuttingDown !== true;
  void input.launchesActive;
  void input.rewardsActive;
  return { reconcile: true, distribute };
}

export function acceptProductionChild(row: ProductionChildRow, canonicalMint: string | null): AcceptedProductionChild | null {
  const mint = addressOf(canonicalMint);
  const child = addressOf(row.mint);
  const quote = addressOf(row.quoteMint);
  const buildQuote = addressOf(row.buildQuote);
  const launcher = addressOf(row.launcher);
  if (!mint || mint === TREST_MINT || !child || !quote || !buildQuote || !launcher) return null;
  if (HISTORICAL.has(child) || HISTORICAL.has(quote) || HISTORICAL.has(buildQuote)) return null;
  if (row.scope !== "production" || quote !== mint || buildQuote !== mint) return null;
  if (!VERIFIED.has(row.attemptStatus ?? "") || !VERIFIED.has(row.submissionStatus ?? "")) return null;
  if (!CATEGORIES.has(row.category as FeeCategory)) return null;
  const originator = addressOf(row.originator);
  return {
    mint: child,
    quoteMint: mint,
    scope: "production",
    category: row.category as FeeCategory,
    launcher,
    originator,
  };
}

export function childFeeWindowKey(scope: "production" | "test", mint: string, windowStartMs: number): string {
  return `child:${scope}:${mint}:${windowStartMs}`;
}

export function productionChildBatch<T extends { scope: "production" | "test"; mint: string }>(
  children: readonly T[],
  completed: readonly string[],
  windowStartMs: number,
  limit = CHILD_FEE_BATCH,
): T[] {
  return children
    .filter((child) => !completed.includes(childFeeWindowKey(child.scope, child.mint, windowStartMs)))
    .slice(0, limit);
}

export function reserveChildDistribution(existing: { status: string } | null): "reserve" | "blocked" {
  if (!existing) return "reserve";
  return "blocked";
}

export function persistedChildIntent(existing: { status: string; signature: string | null } | null): "insert" | "claim" | "withhold" {
  if (!existing) return "insert";
  if (existing.status === "recorded" && existing.signature === null) return "claim";
  return "withhold";
}

export function broadcastPersistedChildIntent(input: { claimed: boolean; shuttingDown: boolean }): boolean {
  return input.claimed === true && input.shuttingDown !== true;
}

export function signedChildIntentBlocksRetry(status: string): boolean {
  return status === "submitted" || status === "uncertain" || status === "unreconciled" || status === "confirmed" || status === "failed";
}

export function receiptRole(input: {
  address: string;
  launcher: string;
  originator: string | null;
}): "launcher" | "developer" | "platform" | null {
  if (input.address === input.launcher) return "launcher";
  if (input.originator && input.address === input.originator) return "developer";
  if (input.address === PLATFORM_FEE_WALLET) return "platform";
  return null;
}

export function acceptedLaunchApproval(input: {
  scope: string;
  approver: string;
  parentMint: string;
}): boolean {
  if (input.scope === "test") return true;
  if (input.scope !== "production") return false;
  return input.approver === PLATFORM_FEE_WALLET && input.parentMint !== TREST_MINT;
}
