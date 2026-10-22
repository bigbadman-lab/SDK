import { PLATFORM_FEE_WALLET, allocateCreatorFees, type FeeCategory, type Shareholder } from "./fees.ts";
import { getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";

import { beginSubmission, type SubmissionIntent, type SubmissionStatus } from "./submission.ts";
import { verifySignedCommitment } from "./v1-signature.ts";

export type StoredLaunchBuild = {
  launchId: string;
  buildId: string;
  accountId: string;
  wallet: string;
  childMint: string;
  parentMint: string;
  scope: "production" | "test";
  messageHash: string;
  blockhash: string;
  expiresAt: number;
  metadataUri: string;
  buyAmount: string;
  shareholders: readonly Shareholder[];
  category: FeeCategory;
  originatorWallet: string | null;
  productionParentRegistered: boolean;
  status: "built" | "signed" | "expired" | "invalidated";
};

export type LaunchApproval = {
  launchId: string;
  buildId: string;
  parentMint: string;
  scope: "production" | "test";
};

export function approvalMatches(build: StoredLaunchBuild, approval: LaunchApproval | null): boolean {
  if (!approval) return false;
  return (
    approval.launchId === build.launchId &&
    approval.buildId === build.buildId &&
    approval.parentMint === build.parentMint &&
    approval.scope === build.scope &&
    (build.scope === "test" || build.productionParentRegistered)
  );
}

function sameShareholders(left: readonly Shareholder[], right: readonly Shareholder[]): boolean {
  const key = (rows: readonly Shareholder[]) => rows.map((row) => `${row.address}:${row.shareBps}`).join(",");
  return key(left) === key(right);
}

export async function planSubmission(input: {
  accountId: string;
  build: StoredLaunchBuild | null;
  transaction: Uint8Array;
  now: number;
  existing: SubmissionIntent | null;
  approval: LaunchApproval | null;
  wireKeyPresent: boolean;
  committedTransaction?: Uint8Array;
}): Promise<
  | { ok: true; intent: SubmissionIntent; broadcast: "hold" | "send" }
  | { ok: false; code: string }
> {
  const build = input.build;
  if (!build || build.launchId.length === 0) return { ok: false, code: "not_found" };
  if (build.accountId !== input.accountId) return { ok: false, code: "forbidden" };
  if (build.status === "expired") return { ok: false, code: "expired" };
  if (build.status === "invalidated") return { ok: false, code: "invalidated" };
  if (build.scope === "production" && !build.productionParentRegistered) return { ok: false, code: "parent_unregistered" };
  if (build.scope === "test" && build.parentMint.length === 0) return { ok: false, code: "parent_unregistered" };
  const fees = allocateCreatorFees({
    category: build.category,
    launcherWallet: build.wallet,
    originatorWallet: build.originatorWallet,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  if (!fees.ok || !sameShareholders(fees.shareholders, build.shareholders)) return { ok: false, code: "fees" };
  const verified = await verifySignedCommitment({
    transaction: input.transaction,
    ...(input.committedTransaction ? { committedTransaction: input.committedTransaction } : {}),
    walletAddress: build.wallet,
    mintAddress: build.childMint,
    messageHash: build.messageHash,
    blockhash: build.blockhash,
    expiresAt: build.expiresAt,
    now: input.now,
    metadataUri: build.metadataUri,
    committedMetadataUri: build.metadataUri,
    buyAmount: build.buyAmount,
    committedBuyAmount: build.buyAmount,
    shareholders: build.shareholders,
    committedShareholders: fees.shareholders,
  });
  if (!verified.ok) return { ok: false, code: verified.code };
  if (!input.wireKeyPresent) return { ok: false, code: "wire_key" };
  const started = beginSubmission(input.existing, {
    launchId: build.launchId,
    buildId: build.buildId,
    childMint: build.childMint,
    parentMint: build.parentMint,
    scope: build.scope,
    wallet: build.wallet,
    signature: signatureOf(input.transaction),
    messageHash: build.messageHash,
    wireRetained: true,
  });
  if (!started.ok) return started;
  const broadcast = started.broadcast === "send" && approvalMatches(build, input.approval) ? "send" : "hold";
  return { ok: true, intent: started.intent, broadcast };
}

export function planRecovery(input: {
  existing: SubmissionIntent | null;
  observed: "confirmed" | "failed" | "missing" | "uncertain" | null;
  blockhashExpired: boolean;
  approvalMatches: boolean;
  wireRetained: boolean;
}): { ok: true; intent: SubmissionIntent; action: "hold" | "rebroadcast" } | { ok: false; code: "not_found" } {
  if (!input.existing) return { ok: false, code: "not_found" };
  const intent = input.observed
    ? noteChainStatus(input.existing, input.observed, input.blockhashExpired)
    : input.existing;
  if (intent.status === "failed" || intent.status === "verified" || intent.status === "page_ready") {
    return { ok: true, intent, action: "hold" };
  }
  if (
    (intent.status === "submission_pending" || intent.status === "uncertain") &&
    input.wireRetained &&
    input.approvalMatches
  ) {
    return { ok: true, intent, action: "rebroadcast" };
  }
  return { ok: true, intent, action: "hold" };
}

function noteChainStatus(
  existing: SubmissionIntent,
  observed: "confirmed" | "failed" | "missing" | "uncertain",
  blockhashExpired: boolean,
): SubmissionIntent {
  if (observed === "confirmed") return { ...existing, status: "verifying" };
  if (observed === "failed") return { ...existing, status: "failed" };
  const status: SubmissionStatus = "uncertain";
  if (blockhashExpired || observed === "missing" || observed === "uncertain") return { ...existing, status };
  return { ...existing, status };
}

function signatureOf(transaction: Uint8Array): string {
  try {
    return getSignatureFromTransaction(getTransactionDecoder().decode(transaction));
  } catch {
    return "";
  }
}
