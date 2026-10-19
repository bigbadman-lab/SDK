import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserSession,
  loadBrowserSession,
  noteSignedIn,
  resetBrowserSessionForTests,
  subscribeBrowserSession,
} from "./browser-session.ts";

test("a sign-in finished during a session read stays signed in", async () => {
  resetBrowserSessionForTests();
  const original = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    const seen: string[] = [];
    const stop = subscribeBrowserSession((session) => seen.push(session.status));
    const pending = loadBrowserSession();
    noteSignedIn("wallet");
    release?.(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await pending;
    const session = getBrowserSession();
    assert.equal(session.status, "signed-in");
    if (session.status !== "signed-in") return;
    assert.equal(session.walletAddress, "wallet");
    assert.deepEqual(seen, ["unknown", "signed-in"]);
    stop();
  } finally {
    globalThis.fetch = original;
    resetBrowserSessionForTests();
  }
});

test("listeners hear a later sign-in without another page load", () => {
  resetBrowserSessionForTests();
  const seen: string[] = [];
  const stop = subscribeBrowserSession((session) => {
    seen.push(session.status === "signed-in" ? session.walletAddress : session.status);
  });
  noteSignedIn("first");
  noteSignedIn("second");
  assert.deepEqual(seen, ["unknown", "first", "second"]);
  stop();
  resetBrowserSessionForTests();
});
