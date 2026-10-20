import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authorizeBuilderDiagnostic } from "./builder-diagnostic.ts";
import { matchTrustedOrigin } from "./site-origin.ts";

const app = "https://sdk.fund";
const operator = { walletAddress: "OperatorWallet" };
const member = { walletAddress: "MemberWallet" };

test("an operator can open the builder diagnostic without an Origin header", () => {
  const decision = authorizeBuilderDiagnostic({
    origin: null,
    host: "sdk.fund",
    secFetchSite: "none",
    configuredAppUrl: app,
    account: operator,
    operator: true,
  });
  assert.deepEqual(decision, { ok: true });
});

test("an unauthenticated builder diagnostic is rejected", () => {
  const decision = authorizeBuilderDiagnostic({
    origin: null,
    host: "sdk.fund",
    secFetchSite: null,
    configuredAppUrl: app,
    account: null,
    operator: false,
  });
  assert.deepEqual(decision, { ok: false, status: 401, code: "unauthenticated" });
});

test("a signed-in non-operator cannot read the builder diagnostic", () => {
  const decision = authorizeBuilderDiagnostic({
    origin: null,
    host: "sdk.fund",
    secFetchSite: "same-origin",
    configuredAppUrl: app,
    account: member,
    operator: false,
  });
  assert.deepEqual(decision, { ok: false, status: 403, code: "forbidden" });
});

test("a cross-site diagnostic request is rejected before the operator check", () => {
  const foreign = authorizeBuilderDiagnostic({
    origin: "https://evil.example",
    host: "sdk.fund",
    secFetchSite: "cross-site",
    configuredAppUrl: app,
    account: operator,
    operator: true,
  });
  assert.deepEqual(foreign, { ok: false, status: 400, code: "origin" });
  const navigation = authorizeBuilderDiagnostic({
    origin: null,
    host: "sdk.fund",
    secFetchSite: "cross-site",
    configuredAppUrl: app,
    account: operator,
    operator: true,
  });
  assert.deepEqual(navigation, { ok: false, status: 400, code: "origin" });
});

test("a state-changing launch build still requires a trusted Origin", () => {
  assert.equal(matchTrustedOrigin(null, "sdk.fund", app), null);
  assert.equal(matchTrustedOrigin("https://evil.example", "sdk.fund", app), null);
  assert.deepEqual(matchTrustedOrigin(app, "sdk.fund", app), {
    origin: app,
    domain: "sdk.fund",
  });
  const source = readFileSync(new URL("../../app/api/launch/build/route.ts", import.meta.url), "utf8");
  const originGate = source.indexOf("if (!trustedOrigin(request))");
  const accountGate = source.indexOf("getCurrentAccount(");
  assert.equal(originGate >= 0 && originGate < accountGate, true);
});
