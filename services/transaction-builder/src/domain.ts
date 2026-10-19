import type { FeeCategory } from "../../../lib/launch/fees.ts";

export type LaunchRecord = {
  launchId: string;
  accountId: string;
  walletAddress: string;
  idempotencyKey: string;
  status: "preparing" | "ready_for_transaction" | "abandoned";
  sourceKind: "draft" | "library";
  sourceId: string;
  versionId: string;
  contentHash: string;
  origin: "private" | "official" | "community";
  originatorAccountId: string | null;
  originatorWallet: string | null;
  feeCategory: FeeCategory;
  tokenName: string;
  tokenSymbol: string;
  metadataHash: string | null;
  metadataUri: string | null;
  buyAmount: string;
  slippageBps: number | null;
};

export type ParentRow = {
  mintAddress: string | null;
  tokenProgram: string | null;
  altAddress: string | null;
  altAuthority: string | null;
  altStatus: "absent" | "prepared" | "created" | "extended" | "warm";
};

export type BuildRow = {
  accountId: string;
  walletAddress: string;
  launchId: string;
  idempotencyKey: string;
  payloadHash: string;
  messageHash: string;
  transaction: string;
  expiresAt: number;
  parentMint: string;
  mintAddress: string;
  blockhash: string;
  contentHash: string;
  metadataHash: string;
  metadataUri: string;
  buyAmount: string;
  shareholdersJson: string;
};

export type LaunchStore = {
  get(launchId: string): Promise<LaunchRecord | null>;
};

export type ParentStore = {
  get(): Promise<ParentRow | null>;
};

export type BuildStore = {
  find(accountId: string, idempotencyKey: string): Promise<BuildRow | null>;
  openLaunchIds(wallet: string, exceptKey: string, now: number): Promise<string[]>;
  insert(row: BuildRow): Promise<"ok" | "conflict">;
  replace(row: BuildRow): Promise<"ok" | "conflict">;
};

export type NonceStore = {
  use(nonce: string, now: number): Promise<"ok" | "replay">;
};
