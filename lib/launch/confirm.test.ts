import assert from "node:assert/strict";
import test from "node:test";

import {
  canOpenConfirmation,
  confirmationStale,
  type ConfirmationBinding,
  type ConfirmationDraft,
} from "./confirm.ts";

const review: ConfirmationBinding = {
  id: "55555555-5555-4555-8555-555555555555",
  ready: true,
  metadataPinned: true,
  imagePinned: true,
  contentHash: "abc",
  versionId: "66666666-6666-4666-8666-666666666666",
  tokenName: "Northstar",
  tokenSymbol: "NORTH",
  tokenDescription: "A working SDK token.",
  website: null,
  twitter: null,
  telegram: null,
  buyAmount: "1.5",
  slippageBps: 100,
  artworkUrl: "/api/launch/artwork/33333333-3333-4333-8333-333333333333",
};

const draft: ConfirmationDraft = {
  name: "Northstar",
  symbol: "NORTH",
  description: "A working SDK token.",
  website: "",
  twitter: "",
  telegram: "",
  buyAmount: "1.50",
  slippageBps: 100,
  assetId: "33333333-3333-4333-8333-333333333333",
  buying: true,
};

test("a ready pin for the same SDK revision can open confirmation", () => {
  assert.equal(
    canOpenConfirmation(review, {
      contentHash: review.contentHash,
      versionId: review.versionId,
    }),
    true
  );
});

test("an unpinned or different revision cannot open confirmation", () => {
  assert.equal(
    canOpenConfirmation(
      { ...review, ready: false },
      { contentHash: review.contentHash, versionId: review.versionId }
    ),
    false
  );
  assert.equal(
    canOpenConfirmation(
      { ...review, metadataPinned: false },
      { contentHash: review.contentHash, versionId: review.versionId }
    ),
    false
  );
  assert.equal(
    canOpenConfirmation(review, {
      contentHash: "other",
      versionId: review.versionId,
    }),
    false
  );
});

test("metadata and artwork edits invalidate the confirmation", () => {
  assert.equal(confirmationStale(review, draft), false);
  assert.equal(confirmationStale(review, { ...draft, name: "Other" }), true);
  assert.equal(
    confirmationStale(review, { ...draft, description: "Changed" }),
    true
  );
  assert.equal(
    confirmationStale(review, {
      ...draft,
      twitter: "https://x.com/sdk",
    }),
    true
  );
  assert.equal(confirmationStale(review, { ...draft, buyAmount: "2" }), true);
  assert.equal(confirmationStale(review, { ...draft, slippageBps: 200 }), true);
  assert.equal(
    confirmationStale(review, {
      ...draft,
      assetId: "77777777-7777-4777-8777-777777777777",
    }),
    true
  );
  assert.equal(confirmationStale(review, { ...draft, assetId: null }), true);
});
