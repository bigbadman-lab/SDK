import assert from "node:assert/strict";
import test from "node:test";

import {
  developerLabel,
  reviewDecision,
  snapshotStands,
  submissionEligibility,
  submissionQuota,
  trustedOriginator,
} from "./submission.ts";

const OWNER = "33333333-3333-4333-8333-333333333333";
const ORIGINAL = "44444444-4444-4444-8444-444444444444";

test("a saved tested blueprint can be submitted and a stale one cannot", () => {
  assert.deepEqual(
    submissionEligibility({ owner: true, saved: true, deleted: false, tested: true, validated: true }),
    { ok: true },
  );
  assert.equal(submissionEligibility({ owner: false, saved: true, deleted: false, tested: true, validated: true }).ok, false);
  assert.deepEqual(
    submissionEligibility({ owner: true, saved: false, deleted: false, tested: true, validated: true }),
    { ok: false, code: "unsaved" },
  );
  assert.deepEqual(
    submissionEligibility({ owner: true, saved: true, deleted: false, tested: false, validated: true }),
    { ok: false, code: "test_required" },
  );
  assert.deepEqual(
    submissionEligibility({ owner: true, saved: true, deleted: true, tested: true, validated: true }),
    { ok: false, code: "deleted" },
  );
});

test("three community submissions fill the day and a retry does not", () => {
  assert.equal(submissionQuota({ usedToday: 2, sameRevisionExists: false }).action, "create");
  assert.deepEqual(submissionQuota({ usedToday: 3, sameRevisionExists: false }), { action: "reject", remaining: 0 });
  assert.deepEqual(submissionQuota({ usedToday: 3, sameRevisionExists: true }), { action: "reuse", remaining: 0 });
  assert.equal(submissionQuota({ usedToday: 0, sameRevisionExists: true }).action, "reuse");
});

test("lineage keeps the original developer and ignores a new beneficiary", () => {
  const remixed = trustedOriginator({
    ownerAccountId: OWNER,
    ownerLabel: developerLabel("OwnerWallet111111111111111111111111111"),
    lineageAccountId: ORIGINAL,
    lineageLabel: "SDK",
  });
  assert.equal(remixed.accountId, ORIGINAL);
  assert.equal(remixed.label, "SDK");
  assert.equal(remixed.submitterIsOriginator, false);
  const original = trustedOriginator({
    ownerAccountId: OWNER,
    ownerLabel: "mine…wall",
    lineageAccountId: null,
    lineageLabel: null,
  });
  assert.equal(original.accountId, OWNER);
  assert.equal(original.submitterIsOriginator, true);
});

test("review actions stay on the first terminal decision", () => {
  assert.equal(reviewDecision("pending", "approve"), "approve");
  assert.equal(reviewDecision("pending", "reject"), "reject");
  assert.equal(reviewDecision("approved", "approve"), "reuse");
  assert.equal(reviewDecision("approved", "reject"), "closed");
  assert.equal(reviewDecision("rejected", "reject"), "reuse");
  assert.equal(reviewDecision("rejected", "approve"), "closed");
});

test("a later private edit does not replace the submitted hash", () => {
  assert.equal(snapshotStands("a".repeat(64), "b".repeat(64)), true);
  assert.equal(snapshotStands("a".repeat(64), "a".repeat(64)), false);
});
