import { createHash } from "node:crypto";

import type { FeeCategory, Shareholder } from "./fees.ts";

export type BuildIdentity = {
  launchId: string;
  idempotencyKey: string;
  mintPublicKey: string;
  launcherWallet: string;
  category: FeeCategory;
  originatorWallet: string | null;
  metadataUri: string;
  metadataHash: string;
  contentHash: string;
  sourceKind: "draft" | "library";
  sourceId: string;
  versionId: string;
  buyAmount: string;
  slippageBps: number | null;
  parentMint: string;
  shareholders: Shareholder[];
};

export type StoredBuild = {
  launchId: string;
  idempotencyKey: string;
  payloadHash: string;
  expiresAt: number;
};

export function payloadHash(identity: BuildIdentity): string {
  const body = JSON.stringify({
    buyAmount: identity.buyAmount,
    category: identity.category,
    contentHash: identity.contentHash,
    idempotencyKey: identity.idempotencyKey,
    launchId: identity.launchId,
    launcherWallet: identity.launcherWallet,
    metadataHash: identity.metadataHash,
    metadataUri: identity.metadataUri,
    mintPublicKey: identity.mintPublicKey,
    originatorWallet: identity.originatorWallet,
    parentMint: identity.parentMint,
    shareholders: identity.shareholders,
    slippageBps: identity.slippageBps,
    sourceId: identity.sourceId,
    sourceKind: identity.sourceKind,
    versionId: identity.versionId,
  });
  return createHash("sha256").update(body).digest("hex");
}

export function bindingDecision(input: {
  now: number;
  launchId: string;
  idempotencyKey: string;
  payloadHash: string;
  existing: StoredBuild | null;
  otherOpenLaunchIds: readonly string[];
}): "create" | "reuse" | "rebuild" | "conflict" {
  if (input.otherOpenLaunchIds.length > 0) return "conflict";
  if (!input.existing) return "create";
  if (
    input.existing.payloadHash !== input.payloadHash ||
    input.existing.launchId !== input.launchId ||
    input.existing.idempotencyKey !== input.idempotencyKey
  ) {
    return "conflict";
  }
  return input.existing.expiresAt > input.now ? "reuse" : "rebuild";
}
