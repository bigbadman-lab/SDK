export type RehearsalReason =
  | "public"
  | "parent_unregistered"
  | "not_ready"
  | "preflight"
  | "approval"
  | "mint_lost"
  | "ready";

export function rehearsalSignAllowed(input: {
  operator: boolean;
  parentRegistered: boolean;
  persistenceReady: boolean;
  committedHash: string | null;
  preflightHash: string | null;
  buildId: string | null;
  approvedBuildId: string | null;
  mintAvailable: boolean;
}): { allowed: boolean; reason: RehearsalReason } {
  if (!input.operator) return { allowed: false, reason: "public" };
  if (!input.parentRegistered) return { allowed: false, reason: "parent_unregistered" };
  if (!input.persistenceReady) return { allowed: false, reason: "not_ready" };
  if (!input.committedHash || input.preflightHash !== input.committedHash) {
    return { allowed: false, reason: "preflight" };
  }
  if (!input.buildId || input.approvedBuildId !== input.buildId) return { allowed: false, reason: "approval" };
  if (!input.mintAvailable) return { allowed: false, reason: "mint_lost" };
  return { allowed: true, reason: "ready" };
}

export function recoveryPhase(status: string): { phase: string; verified: boolean } {
  if (status === "verified" || status === "page_ready") return { phase: "verified", verified: true };
  if (status === "failed") return { phase: "failed", verified: false };
  if (status === "uncertain") return { phase: "recovering", verified: false };
  if (status === "verifying") return { phase: "verifying", verified: false };
  if (status === "submitted" || status === "pending_confirmation") {
    return { phase: "awaiting_confirmation", verified: false };
  }
  return { phase: "submitting", verified: false };
}
