export const COMMUNITY_SUBMISSIONS_PER_DAY = 3;

export type SubmissionStatus = "not_submitted" | "pending" | "approved" | "rejected";

export function developerLabel(walletAddress: string): string {
  const trimmed = walletAddress.trim();
  if (trimmed.length <= 11) return trimmed;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function trustedOriginator(input: {
  ownerAccountId: string;
  ownerLabel: string;
  lineageAccountId: string | null;
  lineageLabel: string | null;
}): { accountId: string | null; label: string; submitterIsOriginator: boolean } {
  const label = input.lineageLabel?.trim() ?? "";
  if (label.length > 0) {
    return {
      accountId: input.lineageAccountId,
      label,
      submitterIsOriginator: input.lineageAccountId === input.ownerAccountId,
    };
  }
  return {
    accountId: input.ownerAccountId,
    label: input.ownerLabel,
    submitterIsOriginator: true,
  };
}

export function submissionEligibility(input: {
  owner: boolean;
  saved: boolean;
  deleted: boolean;
  tested: boolean;
  validated: boolean;
}): { ok: true } | { ok: false; code: "not_owner" | "unsaved" | "deleted" | "test_required" | "blueprint_invalid" } {
  if (!input.owner) return { ok: false, code: "not_owner" };
  if (input.deleted) return { ok: false, code: "deleted" };
  if (!input.saved) return { ok: false, code: "unsaved" };
  if (!input.tested) return { ok: false, code: "test_required" };
  if (!input.validated) return { ok: false, code: "blueprint_invalid" };
  return { ok: true };
}

export function submissionQuota(input: { usedToday: number; sameRevisionExists: boolean }):
  | { action: "reuse"; remaining: number }
  | { action: "create"; remaining: number }
  | { action: "reject"; remaining: 0 } {
  if (input.sameRevisionExists) {
    return { action: "reuse", remaining: allowance(input.usedToday) };
  }
  if (input.usedToday >= COMMUNITY_SUBMISSIONS_PER_DAY) return { action: "reject", remaining: 0 };
  return { action: "create", remaining: allowance(input.usedToday + 1) };
}

export function reviewDecision(
  status: "pending" | "approved" | "rejected",
  action: "approve" | "reject",
): "approve" | "reject" | "reuse" | "closed" {
  if (status === "pending") return action;
  if (status === "approved" && action === "approve") return "reuse";
  if (status === "rejected" && action === "reject") return "reuse";
  return "closed";
}

export function snapshotStands(submittedHash: string, currentDraftHash: string): boolean {
  return submittedHash.length > 0 && submittedHash !== currentDraftHash;
}

function allowance(used: number): number {
  return Math.max(0, COMMUNITY_SUBMISSIONS_PER_DAY - used);
}
