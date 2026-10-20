import { canonicalAddress } from "../auth/solana.ts";

const SOL_QUOTES = new Set([
  "11111111111111111111111111111111",
  "So11111111111111111111111111111111111111112",
]);

const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

export type ParentFeeMode = "single_recipient" | "fee_sharing" | "holder_rewards";

export type ParentObservation = {
  mint: string;
  creator: string;
  feeMode: ParentFeeMode;
  quoteMint: string;
  tokenProgram: string;
  decimals: number;
  mayhem: boolean;
  cashback: boolean;
  holderReward: boolean;
  depth: number;
  maxCurveDepth: number;
  graduated: boolean;
  hasPool: boolean;
  bondingCurve: string | null;
  pool: string | null;
  source: string;
};

export type TestParentRegistration = {
  scope: "test";
  symbol: "TREST";
  mint: string;
  deployer: string;
  feeRecipient: string;
  feeMode: "single_recipient";
  tokenProgram: string;
  decimals: number;
  bondingCurve: string | null;
  graduated: boolean;
  pool: string | null;
  quoteMint: string;
  eligible: true;
  eligibilityReason: "verified";
};

export type ParentReviewCode =
  | "body"
  | "deployer"
  | "fee_mode"
  | "holder_rewards"
  | "parent_ineligible"
  | "production_parent"
  | "quote";

function address(value: unknown): string | null {
  return typeof value === "string" ? canonicalAddress(value) : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableAddress(value: unknown): string | null | undefined {
  if (value === null) return null;
  return address(value) ?? undefined;
}

export function parseParentObservation(
  value: unknown,
): { ok: true; observation: ParentObservation } | { ok: false; code: "body" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "body" };
  const record = value as Record<string, unknown>;
  const keys = [
    "bondingCurve",
    "cashback",
    "creator",
    "decimals",
    "depth",
    "feeMode",
    "graduated",
    "hasPool",
    "holderReward",
    "maxCurveDepth",
    "mayhem",
    "mint",
    "pool",
    "quoteMint",
    "source",
    "tokenProgram",
  ];
  if (Object.keys(record).sort().join(",") !== keys.join(",")) return { ok: false, code: "body" };
  const mint = address(record.mint);
  const creator = address(record.creator);
  const quoteMint = address(record.quoteMint);
  const tokenProgram = address(record.tokenProgram);
  const bondingCurve = nullableAddress(record.bondingCurve);
  const pool = nullableAddress(record.pool);
  const decimals = whole(record.decimals);
  const depth = whole(record.depth);
  const maxCurveDepth = whole(record.maxCurveDepth);
  const mayhem = flag(record.mayhem);
  const cashback = flag(record.cashback);
  const holderReward = flag(record.holderReward);
  const graduated = flag(record.graduated);
  const hasPool = flag(record.hasPool);
  const feeMode = record.feeMode;
  if (
    !mint ||
    !creator ||
    !quoteMint ||
    !tokenProgram ||
    bondingCurve === undefined ||
    pool === undefined ||
    decimals === null ||
    depth === null ||
    maxCurveDepth === null ||
    mayhem === null ||
    cashback === null ||
    holderReward === null ||
    graduated === null ||
    hasPool === null ||
    typeof record.source !== "string" ||
    (feeMode !== "single_recipient" && feeMode !== "fee_sharing" && feeMode !== "holder_rewards")
  ) {
    return { ok: false, code: "body" };
  }
  return {
    ok: true,
    observation: {
      mint,
      creator,
      feeMode,
      quoteMint,
      tokenProgram,
      decimals,
      mayhem,
      cashback,
      holderReward,
      depth,
      maxCurveDepth,
      graduated,
      hasPool,
      bondingCurve,
      pool,
      source: record.source,
    },
  };
}

export function reviewTestParent(input: {
  observation: ParentObservation;
  productionMint: string | null;
  claimedDeployer: string | null;
}): { ok: true; registration: TestParentRegistration } | { ok: false; code: ParentReviewCode } {
  const productionMint = input.productionMint ? canonicalAddress(input.productionMint) : null;
  if (input.productionMint && !productionMint) return { ok: false, code: "body" };
  if (productionMint && productionMint === input.observation.mint) {
    return { ok: false, code: "production_parent" };
  }
  if (input.claimedDeployer !== null) {
    const claimed = canonicalAddress(input.claimedDeployer);
    if (!claimed || claimed !== input.observation.creator) return { ok: false, code: "deployer" };
  }
  if (input.observation.holderReward) return { ok: false, code: "holder_rewards" };
  if (input.observation.source !== "pumpCoin") return { ok: false, code: "parent_ineligible" };
  if (input.observation.mayhem || input.observation.cashback) return { ok: false, code: "parent_ineligible" };
  if (input.observation.maxCurveDepth <= 0) return { ok: false, code: "parent_ineligible" };
  const limit = Math.min(input.observation.maxCurveDepth, 5);
  if (input.observation.depth < 0 || input.observation.depth + 1 > limit) {
    return { ok: false, code: "parent_ineligible" };
  }
  if (input.observation.graduated !== input.observation.hasPool) {
    return { ok: false, code: "parent_ineligible" };
  }
  if (input.observation.graduated && !input.observation.pool) return { ok: false, code: "parent_ineligible" };
  if (!input.observation.graduated && input.observation.pool) return { ok: false, code: "parent_ineligible" };
  if (input.observation.decimals < 0 || input.observation.decimals > 9) {
    return { ok: false, code: "parent_ineligible" };
  }
  if (!TOKEN_PROGRAMS.has(input.observation.tokenProgram)) return { ok: false, code: "parent_ineligible" };
  if (input.observation.feeMode !== "single_recipient") return { ok: false, code: "fee_mode" };
  if (!SOL_QUOTES.has(input.observation.quoteMint)) return { ok: false, code: "quote" };
  return {
    ok: true,
    registration: {
      scope: "test",
      symbol: "TREST",
      mint: input.observation.mint,
      deployer: input.observation.creator,
      feeRecipient: input.observation.creator,
      feeMode: "single_recipient",
      tokenProgram: input.observation.tokenProgram,
      decimals: input.observation.decimals,
      bondingCurve: input.observation.bondingCurve,
      graduated: input.observation.graduated,
      pool: input.observation.pool,
      quoteMint: input.observation.quoteMint,
      eligible: true,
      eligibilityReason: "verified",
    },
  };
}
