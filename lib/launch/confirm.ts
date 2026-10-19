import { canonicalAmount } from "./prepare.ts";

export type ConfirmationBinding = {
  id: string;
  ready: boolean;
  metadataPinned: boolean;
  imagePinned: boolean;
  contentHash: string;
  versionId: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  buyAmount: string;
  slippageBps: number | null;
  artworkUrl: string;
};

export type ConfirmationDraft = {
  name: string;
  symbol: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  buyAmount: string;
  slippageBps: number;
  assetId: string | null;
  buying: boolean;
};

export function canOpenConfirmation(
  review: ConfirmationBinding,
  source: { contentHash: string; versionId: string }
): boolean {
  return (
    review.ready &&
    review.metadataPinned &&
    review.imagePinned &&
    review.id.length > 0 &&
    review.contentHash === source.contentHash &&
    review.versionId === source.versionId
  );
}

export function confirmationStale(
  review: ConfirmationBinding,
  current: ConfirmationDraft
): boolean {
  const amount = canonicalAmount(current.buyAmount.trim() || "0");
  if (amount === null || !current.assetId) return true;
  return (
    review.tokenName !== current.name.trim() ||
    review.tokenSymbol !== current.symbol.trim() ||
    review.tokenDescription !== current.description.trim() ||
    (review.website ?? "") !== current.website.trim() ||
    (review.twitter ?? "") !== current.twitter.trim() ||
    (review.telegram ?? "") !== current.telegram.trim() ||
    review.buyAmount !== amount ||
    review.slippageBps !== (current.buying ? current.slippageBps : null) ||
    !review.artworkUrl.endsWith(current.assetId)
  );
}
