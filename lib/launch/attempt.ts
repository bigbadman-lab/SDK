export const ATTEMPT_STATUSES = [
  "ready_for_transaction",
  "ready_to_sign",
  "awaiting_wallet",
  "wallet_rejected",
  "signed",
  "submission_pending",
  "submitted",
  "pending_confirmation",
  "verifying",
  "verified",
  "page_ready",
  "completed",
  "expired",
  "invalidated",
  "mint_lost",
  "failed",
  "uncertain",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export type LaunchAttempt = {
  wallet: string;
  launchId: string;
  idempotencyKey: string;
  mintPublicKey: string | null;
  messageHash: string | null;
  status: AttemptStatus;
  wasSigned: boolean;
};

const UNRESOLVED = new Set<AttemptStatus>([
  "ready_for_transaction",
  "ready_to_sign",
  "awaiting_wallet",
  "signed",
  "submission_pending",
  "submitted",
  "pending_confirmation",
  "verifying",
  "verified",
  "page_ready",
  "completed",
  "failed",
  "uncertain",
]);

export function isUnresolved(attempt: LaunchAttempt): boolean {
  if (UNRESOLVED.has(attempt.status)) return true;
  return attempt.status === "mint_lost" && attempt.wasSigned;
}

export function startAttempt(input: {
  existing: readonly LaunchAttempt[];
  wallet: string;
  launchId: string;
  idempotencyKey: string;
}): { ok: true; attempt: LaunchAttempt } | { ok: false; code: "unresolved" } {
  const open = input.existing.find((attempt) => attempt.wallet === input.wallet && isUnresolved(attempt));
  if (open && (open.launchId !== input.launchId || open.idempotencyKey !== input.idempotencyKey)) {
    return { ok: false, code: "unresolved" };
  }
  if (open) return { ok: true, attempt: open };
  return {
    ok: true,
    attempt: {
      wallet: input.wallet,
      launchId: input.launchId,
      idempotencyKey: input.idempotencyKey,
      mintPublicKey: null,
      messageHash: null,
      status: "ready_for_transaction",
      wasSigned: false,
    },
  };
}

export function bindMint(
  attempt: LaunchAttempt,
  mintPublicKey: string,
): { ok: true; attempt: LaunchAttempt } | { ok: false; code: "mint_conflict" | "signed_unresolved" } {
  if (attempt.wasSigned) return { ok: false, code: "signed_unresolved" };
  if (attempt.mintPublicKey && attempt.mintPublicKey !== mintPublicKey) {
    return { ok: false, code: "mint_conflict" };
  }
  return {
    ok: true,
    attempt: {
      ...attempt,
      mintPublicKey,
      status: attempt.status === "awaiting_wallet" ? attempt.status : "ready_to_sign",
    },
  };
}

export function markAwaitingWallet(attempt: LaunchAttempt): LaunchAttempt {
  return { ...attempt, status: "awaiting_wallet" };
}

export function markWalletRejected(attempt: LaunchAttempt): LaunchAttempt {
  return { ...attempt, status: "wallet_rejected" };
}

export function markSigned(attempt: LaunchAttempt, messageHash: string): LaunchAttempt {
  return { ...attempt, status: "signed", wasSigned: true, messageHash };
}

export function markExpired(attempt: LaunchAttempt): LaunchAttempt {
  if (
    attempt.status === "submitted" ||
    attempt.status === "pending_confirmation" ||
    attempt.status === "verifying" ||
    attempt.status === "uncertain" ||
    attempt.status === "verified" ||
    attempt.status === "page_ready" ||
    attempt.status === "completed"
  ) {
    return attempt;
  }
  if (attempt.wasSigned) return { ...attempt, status: "signed" };
  return { ...attempt, status: "expired" };
}

export function markSubmissionPending(attempt: LaunchAttempt): LaunchAttempt | null {
  if (attempt.status !== "signed" || !attempt.mintPublicKey || !attempt.messageHash) return null;
  return { ...attempt, status: "submission_pending" };
}

export function markInvalidated(attempt: LaunchAttempt): LaunchAttempt {
  if (attempt.wasSigned) return attempt;
  return { ...attempt, status: "invalidated", messageHash: null };
}

export function markMintLost(attempt: LaunchAttempt): LaunchAttempt {
  return { ...attempt, status: "mint_lost" };
}

export function canReplaceMint(attempt: LaunchAttempt): boolean {
  if (attempt.wasSigned || isUnresolved(attempt)) return false;
  return (
    attempt.status === "wallet_rejected" ||
    attempt.status === "expired" ||
    attempt.status === "invalidated" ||
    attempt.status === "mint_lost"
  );
}
