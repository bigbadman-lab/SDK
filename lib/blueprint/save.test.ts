import assert from "node:assert/strict";
import test from "node:test";
import {
  accountDestination,
  deleteDecision,
  isListedSdk,
  isSameSavedIdentity,
  launchAction,
  parseSdkIdentity,
  saveAllowed,
  shouldRedirectAfterSave,
} from "./save.ts";

test("a successful test authorizes only the blueprint hash that was executed", () => {
  assert.equal(saveAllowed("hash-a", "hash-a"), true);
  assert.equal(saveAllowed("hash-b", "hash-a"), false);
  assert.equal(saveAllowed("hash-a", null), false);
  assert.equal(saveAllowed("", "hash-a"), false);
});

test("unsaved workspaces stay out of My SDKs and an identical save is one record", () => {
  assert.equal(isListedSdk(null), false);
  assert.equal(isListedSdk("2026-10-19T00:00:00.000Z"), true);
  assert.equal(
    isListedSdk("2026-10-19T00:00:00.000Z", "2026-10-19T01:00:00.000Z"),
    false
  );
  assert.equal(
    isSameSavedIdentity(
      {
        savedHash: "hash-a",
        savedName: "Wallet summary",
        savedDescription: "Reads recent activity.",
      },
      {
        hash: "hash-a",
        name: "Wallet summary",
        description: "Reads recent activity.",
      }
    ),
    true
  );
  assert.equal(
    isSameSavedIdentity(
      {
        savedHash: "hash-a",
        savedName: "Wallet summary",
        savedDescription: "Reads recent activity.",
      },
      {
        hash: "hash-a",
        name: "Activity desk",
        description: "Reads recent activity.",
      }
    ),
    false
  );
});

test("sdk names and descriptions are bounded before they are stored", () => {
  assert.deepEqual(
    parseSdkIdentity("  Wallet   summary ", "  Reads recent activity. "),
    {
      ok: true,
      name: "Wallet summary",
      description: "Reads recent activity.",
    }
  );
  assert.deepEqual(parseSdkIdentity("   ", "A description"), {
    ok: false,
    code: "name",
  });
  assert.deepEqual(parseSdkIdentity("Named", "   "), {
    ok: false,
    code: "description",
  });
  assert.equal(parseSdkIdentity("n".repeat(81), "A description").ok, false);
  assert.equal(parseSdkIdentity("Named", "d".repeat(501)).ok, false);
});

const SAVED_ID = "11111111-1111-4111-8111-111111111111";

test("a confirmed save redirects only with the saved sdk id", () => {
  assert.equal(
    shouldRedirectAfterSave({ ok: true, saved: true, draftId: SAVED_ID }),
    true
  );
  assert.equal(
    accountDestination(SAVED_ID),
    `/account?sdk=${SAVED_ID}&saved=1`
  );
  assert.equal(
    shouldRedirectAfterSave({ ok: false, saved: true, draftId: SAVED_ID }),
    false
  );
  assert.equal(
    shouldRedirectAfterSave({ ok: true, saved: false, draftId: SAVED_ID }),
    false
  );
  assert.equal(
    shouldRedirectAfterSave({ ok: true, saved: true, draftId: null }),
    false
  );
  assert.equal(shouldRedirectAfterSave({ ok: true, saved: true }), false);
});

test("a tested sdk opens launch preparation and an untested sdk does not", () => {
  assert.deepEqual(launchAction({ sdkId: SAVED_ID, tested: true }), {
    sdkId: SAVED_ID,
    href: `/launch?draft=${SAVED_ID}`,
    label: "Prepare launch",
  });
  assert.deepEqual(launchAction({ sdkId: SAVED_ID, tested: false }), {
    sdkId: SAVED_ID,
    href: null,
    label: "Test before launch",
  });
});

test("only the owner can delete a saved sdk, and a repeat is idempotent", () => {
  assert.equal(deleteDecision(null), "reject");
  assert.equal(
    deleteDecision({ owner: false, saved: true, deleted: false }),
    "reject"
  );
  assert.equal(
    deleteDecision({ owner: true, saved: false, deleted: false }),
    "reject"
  );
  assert.equal(
    deleteDecision({ owner: true, saved: true, deleted: false }),
    "delete"
  );
  assert.equal(
    deleteDecision({ owner: true, saved: true, deleted: true }),
    "already_deleted"
  );
});
