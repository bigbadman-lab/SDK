import { canonicalAddress } from "../auth/solana.ts";

export const NETWORK_FEE_RESERVE = "5000";

export function sweepExecutionAuthorised(value: string | null | undefined): boolean {
  return value === "true";
}

export function sweepLiabilityAuthorised(value: string | null | undefined): boolean {
  return value === "true";
}

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

export type SweepParent = "trest" | "sdk";

export type SweepLiabilities = {
  claimableSol: string;
  claimableToken: string;
  deployerRetained: string;
  unspentBuyback: string;
  unallocated: string;
};

export type SweepPlan = {
  parent: SweepParent;
  destination: string;
  signer: string;
  solLamports: string;
  tokenAmount: string;
  liabilities: SweepLiabilities;
  shortfall: boolean;
  inFlight: boolean;
  suspended: boolean;
  duplicate: boolean;
  locked: boolean;
};

function parse(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

export function transferableLamports(balance: string, rentMinimum: string, feeReserve: string): string | null {
  const available = parse(balance);
  const rent = parse(rentMinimum);
  const fee = parse(feeReserve);
  if (available === null || rent === null || fee === null) return null;
  const transferable = available - rent - fee;
  return (transferable > BigInt(0) ? transferable : BigInt(0)).toString();
}

export function planSweep(input: {
  parent: SweepParent;
  destination: string;
  signer: string;
  solBalance: string;
  rentMinimum: string;
  feeReserve: string;
  tokenBalance: string;
  liabilities: SweepLiabilities;
  inFlightClaim: boolean;
  inFlightBuyback: boolean;
  suspended: boolean;
  alreadyExecuted: boolean;
  locked?: boolean;
}): SweepPlan | { ok: false; code: "amount" | "destination" | "parent" } {
  if (input.parent !== "trest" && input.parent !== "sdk") return { ok: false, code: "parent" };
  const destination = canonicalAddress(input.destination);
  const signer = canonicalAddress(input.signer);
  if (!destination || !signer || destination === signer) return { ok: false, code: "destination" };
  const sol = transferableLamports(input.solBalance, input.rentMinimum, input.feeReserve);
  const token = parse(input.tokenBalance);
  const fields = Object.values(input.liabilities);
  if (sol === null || token === null || fields.some((value) => parse(value) === null)) return { ok: false, code: "amount" };
  const claimable = BigInt(input.liabilities.claimableSol) + BigInt(input.liabilities.claimableToken);
  return {
    parent: input.parent,
    destination,
    signer,
    solLamports: sol,
    tokenAmount: token.toString(),
    liabilities: input.liabilities,
    shortfall: claimable > BigInt(0),
    inFlight: input.inFlightClaim || input.inFlightBuyback,
    suspended: input.suspended,
    duplicate: input.alreadyExecuted,
    locked: input.locked === true,
  };
}

export function authoriseSweep(input: {
  requested: "dry-run" | "execute";
  executionEnabled: boolean;
  liabilityAuthorised: boolean;
  approval: string | null;
  plan: SweepPlan;
  parent: SweepParent;
  signer: string;
  destination: string;
}): { ok: true; mode: "dry-run" | "execute" } | { ok: false; code: "approval_required" | "destination" | "duplicate" | "execution_disabled" | "holder_liability_unauthorised" | "in_flight" | "locked" | "parent" | "signer" | "suspended" } {
  if (input.plan.parent !== input.parent) return { ok: false, code: "parent" };
  if (input.plan.signer !== input.signer) return { ok: false, code: "signer" };
  if (input.plan.destination !== input.destination) return { ok: false, code: "destination" };
  if (input.requested === "dry-run") return { ok: true, mode: "dry-run" };
  if (!input.executionEnabled) return { ok: false, code: "execution_disabled" };
  if (!input.approval || input.approval.length < 32) return { ok: false, code: "approval_required" };
  if (input.plan.suspended) return { ok: false, code: "suspended" };
  if (input.plan.locked) return { ok: false, code: "locked" };
  if (input.plan.duplicate) return { ok: false, code: "duplicate" };
  if (input.plan.inFlight) return { ok: false, code: "in_flight" };
  if (input.plan.shortfall && !input.liabilityAuthorised) return { ok: false, code: "holder_liability_unauthorised" };
  return { ok: true, mode: "execute" };
}

export type SweepAudit = {
  mode: "dry_run" | "execute";
  status: "planned" | "submitted" | "confirmed" | "failed" | "uncertain" | "disabled";
  solLamports: string;
  tokenAmount: string;
  shortfall: boolean;
  signature: string | null;
};

export function openSweep(input: {
  requested: "dry-run" | "execute";
  executionEnabled: boolean;
  liabilityAuthorised: boolean;
  approval: string | null;
  plan: SweepPlan;
}): { broadcast: boolean; fence: boolean; audit: SweepAudit; code: string } {
  const decision = authoriseSweep({ ...input, parent: input.plan.parent, signer: input.plan.signer, destination: input.plan.destination });
  const audit: SweepAudit = {
    mode: input.requested === "execute" ? "execute" : "dry_run",
    status: "planned",
    solLamports: input.plan.solLamports,
    tokenAmount: input.plan.tokenAmount,
    shortfall: input.plan.shortfall,
    signature: null,
  };
  if (!decision.ok) {
    audit.status = "disabled";
    return { broadcast: false, fence: false, audit, code: decision.code };
  }
  if (decision.mode === "dry-run") return { broadcast: false, fence: false, audit, code: "dry-run" };
  audit.mode = "execute";
  audit.status = "submitted";
  return { broadcast: true, fence: true, audit, code: "execute" };
}

export function settleSweep(status: "confirmed" | "failed" | "uncertain"): {
  complete: boolean;
  liabilities: "unfunded" | "unchanged" | "unresolved";
} {
  if (status === "confirmed") return { complete: true, liabilities: "unfunded" };
  if (status === "failed") return { complete: false, liabilities: "unchanged" };
  return { complete: false, liabilities: "unresolved" };
}
