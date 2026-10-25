import assert from "node:assert/strict";
import test from "node:test";

import { LIBRARY_VOTE_WINDOW_MS, libraryVoteDecision } from "./votes.ts";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

test("a library like is allowed once per SDK in a rolling 24 hours", () => {
  assert.deepEqual(libraryVoteDecision({ now: NOW, lastVoteAt: null }), { action: "cast" });
  assert.deepEqual(libraryVoteDecision({ now: NOW, lastVoteAt: NOW - 1 }), {
    action: "wait",
    retryAt: NOW - 1 + LIBRARY_VOTE_WINDOW_MS,
  });
  assert.deepEqual(libraryVoteDecision({ now: NOW, lastVoteAt: NOW - LIBRARY_VOTE_WINDOW_MS + 1 }), {
    action: "wait",
    retryAt: NOW + 1,
  });
  assert.deepEqual(libraryVoteDecision({ now: NOW, lastVoteAt: NOW - LIBRARY_VOTE_WINDOW_MS }), {
    action: "cast",
  });
  assert.equal(LIBRARY_VOTE_WINDOW_MS, 86_400_000);
});
