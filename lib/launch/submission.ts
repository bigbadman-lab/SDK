import type { BroadcastOutcome } from "./broadcast.ts";
import type { VerificationVerdict } from "./chain-evidence.ts";
import { confirmationStatus } from "./post-launch.ts";

export const SUBMISSION_STATUSES = [
  "submission_pending",
  "submitted",
  "pending_confirmation",
  "verifying",
  "verified",
  "page_ready",
  "failed",
  "uncertain",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export type SubmissionIntent = {
  launchId: string;
  buildId: string;
  childMint: string;
  parentMint: string;
  scope: "production" | "test";
  wallet: string;
  signature: string;
  messageHash: string;
  status: SubmissionStatus;
  wireRetained: boolean;
  slot?: string | null;
  verifiedAtMs?: number | null;
};

export type SubmissionDraft = Omit<SubmissionIntent, "status">;

const OPEN = new Set<SubmissionStatus>([
  "submission_pending",
  "submitted",
  "pending_confirmation",
  "verifying",
  "uncertain",
]);

export function beginSubmission(
  existing: SubmissionIntent | null,
  next: SubmissionDraft,
): { ok: true; intent: SubmissionIntent; broadcast: "hold" | "send" } | { ok: false; code: "conflict" | "uncertain" | "wire_key" } {
  if (!existing) {
    if (!next.wireRetained) return { ok: false, code: "wire_key" };
    return { ok: true, intent: { ...next, status: "submission_pending" }, broadcast: "send" };
  }
  const same =
    existing.launchId === next.launchId &&
    existing.buildId === next.buildId &&
    existing.childMint === next.childMint &&
    existing.parentMint === next.parentMint &&
    existing.scope === next.scope &&
    existing.signature === next.signature &&
    existing.messageHash === next.messageHash;
  if (!same) return { ok: false, code: "conflict" };
  if (existing.status === "submission_pending") {
    return { ok: true, intent: existing, broadcast: existing.wireRetained ? "send" : "hold" };
  }
  if (OPEN.has(existing.status) || existing.status === "verified" || existing.status === "page_ready" || existing.status === "failed") {
    return { ok: true, intent: existing, broadcast: "hold" };
  }
  return { ok: false, code: "conflict" };
}

export function noteBroadcast(intent: SubmissionIntent, outcome: BroadcastOutcome): SubmissionIntent {
  if (outcome === "accepted") return { ...intent, status: "submitted" };
  if (outcome === "rejected") {
    if (intent.status === "submitted" || intent.status === "uncertain" || intent.status === "pending_confirmation") {
      return intent;
    }
    return { ...intent, status: "failed" };
  }
  return { ...intent, status: "uncertain" };
}

export function noteChain(
  intent: SubmissionIntent,
  observed: "confirmed" | "failed" | "missing" | "uncertain",
  blockhashExpired: boolean,
): SubmissionIntent {
  return { ...intent, status: confirmationStatus({ status: intent.status, observed, blockhashExpired }) };
}

export function noteVerification(intent: SubmissionIntent, verdict: VerificationVerdict): SubmissionIntent {
  if (intent.status !== "verifying" && intent.status !== "pending_confirmation") return intent;
  if (verdict.verified) return { ...intent, status: "verified" };
  if (verdict.failed) return { ...intent, status: "failed" };
  return { ...intent, status: "verifying" };
}

export function markPageReady(intent: SubmissionIntent): SubmissionIntent | null {
  if (intent.status !== "verified") return null;
  return { ...intent, status: "page_ready" };
}
