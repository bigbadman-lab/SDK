import { TREST_MINT, pairLabel, type ParentSymbol } from "./verified-launch.ts";

export const CONFIRMATION_LIMIT_MS = 90_000;

export const UNRESOLVED_SUBMISSIONS = [
  "submission_pending",
  "submitted",
  "pending_confirmation",
  "verifying",
  "uncertain",
] as const;

const ACCEPTED = new Set(["submitted", "pending_confirmation", "verifying"]);

export type LaunchWatch =
  | "awaiting_wallet"
  | "rejected"
  | "launching"
  | "finalising"
  | "live"
  | "failed"
  | "delayed"
  | "other";

export type OpenLaunch = {
  launchId: string;
  status: string;
  scope: "production" | "test";
  childMint: string;
  parentMint: string;
  signature: string;
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  pairLabel: "$SDK" | "$TREST";
};

export function blocksNewLaunch(status: string): boolean {
  return (UNRESOLVED_SUBMISSIONS as readonly string[]).includes(status);
}

export function nextPollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= CONFIRMATION_LIMIT_MS) return null;
  if (elapsedMs < 10_000) return 2_000;
  if (elapsedMs < 30_000) return 4_000;
  if (elapsedMs < 60_000) return 8_000;
  return 12_000;
}

export function confirmationStatus(input: {
  status: string;
  observed: "confirmed" | "failed" | "missing" | "uncertain";
  blockhashExpired: boolean;
}): "submission_pending" | "submitted" | "pending_confirmation" | "verifying" | "verified" | "page_ready" | "failed" | "uncertain" {
  if (input.status === "verified" || input.status === "page_ready" || input.status === "failed") return input.status;
  if (input.observed === "confirmed") return "verifying";
  if (input.observed === "failed") return "failed";
  if (ACCEPTED.has(input.status) && !input.blockhashExpired) {
    if (input.status === "submitted" || input.status === "pending_confirmation" || input.status === "verifying") {
      return input.status;
    }
  }
  return "uncertain";
}

export function recoveryBroadcast(prior: string, next: string): "hold" | "rebroadcast" {
  void prior;
  void next;
  return "hold";
}

export function watchLaunch(input: {
  phase: string;
  elapsedMs: number | null;
  signature: string | null;
}): { watch: LaunchWatch; polling: boolean } {
  if (input.phase === "verified") return { watch: "live", polling: false };
  if (input.phase === "failed") return { watch: "failed", polling: false };
  if (input.phase === "wallet_rejected") return { watch: "rejected", polling: false };
  if (input.phase === "awaiting_wallet") return { watch: "awaiting_wallet", polling: false };
  const elapsed = input.elapsedMs ?? 0;
  const overdue = elapsed >= CONFIRMATION_LIMIT_MS;
  if (input.phase === "verifying") return { watch: "finalising", polling: !overdue };
  if ((input.phase === "awaiting_confirmation" || input.phase === "recovering") && input.signature) {
    if (overdue) return { watch: "delayed", polling: false };
    return { watch: "launching", polling: true };
  }
  return { watch: "other", polling: false };
}

export function launchWatchCopy(watch: LaunchWatch): { title: string; body: string } {
  if (watch === "awaiting_wallet") {
    return {
      title: "Approve your launch in Phantom",
      body: "Review and approve the transaction in your wallet to launch your SDK token.",
    };
  }
  if (watch === "rejected") {
    return {
      title: "Wallet rejected",
      body: "Phantom declined the transaction. Nothing was submitted.",
    };
  }
  if (watch === "launching") {
    return {
      title: "Your SDK token is launching",
      body: "Your transaction has been submitted to Solana. We're confirming your launch. Please be patient — this can take a little longer during network congestion.",
    };
  }
  if (watch === "finalising") {
    return {
      title: "Finalising your SDK launch",
      body: "Your transaction has confirmed. We're verifying your token and making it available across SDK.",
    };
  }
  if (watch === "live") {
    return {
      title: "Your SDK token is live!",
      body: "Your token has been successfully launched and verified on Solana.",
    };
  }
  if (watch === "failed") {
    return {
      title: "Your launch could not be completed",
      body: "The recorded chain evidence shows this launch did not succeed. The original transaction was not replaced, and a new mint was not created.",
    };
  }
  if (watch === "delayed") {
    return {
      title: "Your launch is still being confirmed",
      body: "Solana hasn't returned a final result yet. Your transaction may still succeed. You can safely return to this launch to check its status.",
    };
  }
  return { title: "", body: "" };
}

export function failureExplanation(signature: string | null, notice: string | null): string {
  if (!signature) return notice ?? "This launch did not start. Nothing was submitted.";
  return launchWatchCopy("failed").body;
}

export function toOpenLaunch(row: {
  launchId: string;
  status: string;
  scope: "production" | "test";
  childMint: string;
  parentMint: string;
  signature: string;
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  parentSymbol: ParentSymbol | null;
}): OpenLaunch | null {
  if (!blocksNewLaunch(row.status)) return null;
  const symbol =
    row.parentSymbol ??
    (row.scope === "test" && row.parentMint === TREST_MINT ? "TREST" : row.scope === "production" ? "SDK" : null);
  const label = pairLabel({ scope: row.scope, symbol });
  if (!label || !symbol) return null;
  return {
    launchId: row.launchId,
    status: row.status,
    scope: row.scope,
    childMint: row.childMint,
    parentMint: row.parentMint,
    signature: row.signature,
    tokenName: row.tokenName,
    tokenSymbol: row.tokenSymbol,
    imageUrl: row.imageUrl?.startsWith("https://") ? row.imageUrl : null,
    pairLabel: label,
  };
}
