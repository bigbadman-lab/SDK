import assert from "node:assert/strict";
import test from "node:test";

import {
  isLaunchEligibleDraft,
  launchCatalogHref,
  launchDraftHref,
  launchLibraryHref,
  launchPageMode,
  matchesSdkQuery,
} from "./catalog.ts";

test("launch opens the selector until one source is chosen", () => {
  assert.equal(launchPageMode({ signedIn: false }), "choose");
  assert.equal(launchPageMode({ signedIn: true }), "choose");
  assert.equal(
    launchPageMode({ signedIn: true, draftId: "  ", librarySdkId: "" }),
    "choose"
  );
});

test("a private SDK stays behind sign-in and a public one stays in the URL", () => {
  assert.equal(
    launchPageMode({ signedIn: false, draftId: "draft-1" }),
    "private-sign-in"
  );
  assert.equal(
    launchPageMode({ signedIn: false, librarySdkId: "sdk-1" }),
    "public-hold"
  );
  assert.equal(
    launchPageMode({ signedIn: true, draftId: "draft-1" }),
    "resolve"
  );
  assert.equal(
    launchPageMode({ signedIn: true, librarySdkId: "sdk-1" }),
    "resolve"
  );
});

test("two sources in one URL are rejected", () => {
  assert.equal(
    launchPageMode({
      signedIn: true,
      draftId: "draft-1",
      librarySdkId: "sdk-1",
    }),
    "conflict"
  );
});

test("source links use the existing launch contract and carry no blueprint", () => {
  const draft = launchDraftHref("11111111-1111-4111-8111-111111111111");
  const library = launchLibraryHref(
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  );
  assert.equal(draft, "/launch?draft=11111111-1111-4111-8111-111111111111");
  assert.equal(
    library,
    "/launch?library=22222222-2222-4222-8222-222222222222&version=33333333-3333-4333-8333-333333333333"
  );
  assert.equal(launchCatalogHref({ q: "", page: 1 }), "/launch");
  assert.equal(
    launchCatalogHref({ q: "prompt", page: 2 }),
    "/launch?q=prompt&page=2"
  );
  for (const href of [draft, library]) {
    assert.equal(href.includes("blueprint"), false);
    assert.equal(href.includes("recipient"), false);
    assert.equal(href.includes("contentHash"), false);
  }
});

test("only a tested saved revision can be selected from My SDKs", () => {
  const ready = {
    tested: true,
    versionId: "version",
    contentHash: "hash",
  };
  assert.equal(isLaunchEligibleDraft(ready), true);
  assert.equal(isLaunchEligibleDraft({ ...ready, tested: false }), false);
  assert.equal(isLaunchEligibleDraft({ ...ready, versionId: null }), false);
  assert.equal(isLaunchEligibleDraft({ ...ready, contentHash: null }), false);
});

test("selector search matches the name or description", () => {
  const sdk = {
    name: "Prompt Architect",
    description: "Rewrites an instruction.",
  };
  assert.equal(matchesSdkQuery(sdk, ""), true);
  assert.equal(matchesSdkQuery(sdk, "architect"), true);
  assert.equal(matchesSdkQuery(sdk, "instruction"), true);
  assert.equal(matchesSdkQuery(sdk, "wallet"), false);
});
