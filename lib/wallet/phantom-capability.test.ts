import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPhantomCapability,
  describePhantomCapability,
  formatAdvertisedVersions,
  observeWallet,
  phantomCapabilityCopy,
  type ObservedWallet,
} from "./phantom-capability.ts";

const ADDRESS = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const OTHER = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";

function phantom(versions: readonly (string | number)[] | null, address = ADDRESS): ObservedWallet {
  return {
    name: "Phantom",
    accounts: [{ address }],
    signTransactionVersions: versions,
  };
}

test("a Phantom account that advertises version 1 is ready", () => {
  const state = assessPhantomCapability({
    sessionAddress: ADDRESS,
    connectedAddress: ADDRESS,
    wallets: [phantom(["legacy", 0, 1])],
  });
  assert.equal(state, "ready");
  assert.equal(phantomCapabilityCopy(state), null);
});

test("legacy and version 0 alone are not version 1", () => {
  assert.equal(
    assessPhantomCapability({
      sessionAddress: ADDRESS,
      connectedAddress: ADDRESS,
      wallets: [phantom(["legacy", 0])],
    }),
    "phantom_v1_unavailable",
  );
  const copy = phantomCapabilityCopy("phantom_v1_unavailable");
  assert.equal(copy?.title, "Update Phantom to launch");
});

test("another wallet, a different account, and a missing feature stay blocked", () => {
  assert.equal(
    assessPhantomCapability({
      sessionAddress: ADDRESS,
      connectedAddress: ADDRESS,
      wallets: [{ name: "Other", accounts: [{ address: ADDRESS }], signTransactionVersions: ["legacy", 0, 1] }],
    }),
    "unsupported_wallet",
  );
  assert.equal(
    assessPhantomCapability({
      sessionAddress: ADDRESS,
      connectedAddress: ADDRESS,
      wallets: [phantom(["legacy", 0, 1], OTHER)],
    }),
    "wallet_account_mismatch",
  );
  assert.equal(
    assessPhantomCapability({
      sessionAddress: ADDRESS,
      connectedAddress: ADDRESS,
      wallets: [phantom(null)],
    }),
    "wallet_feature_unavailable",
  );
  assert.equal(phantomCapabilityCopy("unsupported_wallet")?.title, "Phantom required");
});

test("a disconnected or stale session is not ready", () => {
  assert.equal(
    assessPhantomCapability({
      sessionAddress: ADDRESS,
      connectedAddress: null,
      wallets: [phantom(["legacy", 0, 1])],
    }),
    "wallet_disconnected",
  );
  assert.equal(
    assessPhantomCapability({
      sessionAddress: OTHER,
      connectedAddress: ADDRESS,
      wallets: [phantom(["legacy", 0, 1])],
    }),
    "wallet_session_invalid",
  );
  assert.equal(
    assessPhantomCapability({
      sessionAddress: null,
      connectedAddress: ADDRESS,
      wallets: [phantom(["legacy", 0, 1])],
    }),
    "wallet_session_invalid",
  );
});

test("the development diagnostic reports the live capability fields", () => {
  const ready = describePhantomCapability({
    sessionAddress: ADDRESS,
    connectedAddress: ADDRESS,
    wallets: [phantom(["legacy", 0, 1])],
  });
  assert.equal(ready.reownConnected, true);
  assert.equal(ready.identifiedAsPhantom, true);
  assert.equal(ready.sessionMatches, true);
  assert.equal(ready.phantomAccountFound, true);
  assert.equal(ready.signTransactionAvailable, true);
  assert.equal(formatAdvertisedVersions(ready.advertisedVersions), "legacy, 0, 1");
  assert.equal(ready.v1Supported, true);
  assert.equal(ready.state, "ready");

  const outdated = describePhantomCapability({
    sessionAddress: ADDRESS,
    connectedAddress: ADDRESS,
    wallets: [phantom(["legacy", 0])],
  });
  assert.equal(outdated.v1Supported, false);
  assert.equal(outdated.state, "phantom_v1_unavailable");
  assert.equal(formatAdvertisedVersions(outdated.advertisedVersions), "legacy, 0");

  const other = describePhantomCapability({
    sessionAddress: ADDRESS,
    connectedAddress: ADDRESS,
    wallets: [{ name: "Other", accounts: [{ address: ADDRESS }], signTransactionVersions: [1] }],
  });
  assert.equal(other.identifiedAsPhantom, false);
  assert.equal(other.phantomAccountFound, false);
  assert.equal(other.signTransactionAvailable, false);
  assert.equal(formatAdvertisedVersions(other.advertisedVersions), "none");
  assert.equal(other.state, "unsupported_wallet");
});

test("wallet observation reads the signing feature and does not invent version 1", () => {
  const observed = observeWallet({
    name: "Phantom",
    accounts: [{ address: ADDRESS }],
    features: { "solana:signTransaction": { supportedTransactionVersions: ["legacy", 0] } },
  });
  assert.deepEqual(observed.signTransactionVersions, ["legacy", 0]);
  const missing = observeWallet({
    name: "Phantom",
    accounts: [{ address: ADDRESS }],
    features: {},
  });
  assert.equal(missing.signTransactionVersions, null);
});
