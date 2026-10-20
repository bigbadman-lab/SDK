import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseParentObservationRequest } from "./builder-request.ts";
import { bindLaunchParent, publicLaunchScope, selectLaunchParent } from "./parent-scope.ts";
import { parseParentObservation, reviewTestParent, type ParentObservation } from "./parent.ts";

const TREST = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const DEPLOYER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const PRODUCTION = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const POOL = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL = "11111111111111111111111111111111";
const LAUNCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MINT = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";

function observation(overrides: Partial<ParentObservation> = {}): ParentObservation {
  return {
    mint: TREST,
    creator: DEPLOYER,
    feeMode: "single_recipient",
    quoteMint: SOL,
    tokenProgram: SPL,
    decimals: 6,
    mayhem: false,
    cashback: false,
    holderReward: false,
    depth: 0,
    maxCurveDepth: 5,
    graduated: false,
    hasPool: false,
    bondingCurve: OTHER,
    pool: null,
    source: "pumpCoin",
    ...overrides,
  };
}

test("a verified single-recipient SOL parent registers in the test scope", () => {
  const production = Object.freeze({ id: 1, mint: PRODUCTION });
  const parsed = parseParentObservation(observation());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const reviewed = reviewTestParent({
    observation: parsed.observation,
    productionMint: production.mint,
    claimedDeployer: null,
  });
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) return;
  assert.equal(reviewed.registration.scope, "test");
  assert.equal(reviewed.registration.symbol, "TREST");
  assert.equal(reviewed.registration.mint, TREST);
  assert.equal(reviewed.registration.deployer, DEPLOYER);
  assert.equal(reviewed.registration.feeRecipient, DEPLOYER);
  assert.equal(reviewed.registration.eligible, true);
  assert.equal(production.mint, PRODUCTION);
  assert.equal(production.id, 1);
});

function reviewCode(result: ReturnType<typeof reviewTestParent>): string {
  assert.equal(result.ok, false);
  if (result.ok) return "";
  return result.code;
}

test("parent verification failures are rejected before registration", () => {
  assert.equal(parseParentObservation({ ...observation(), extra: true }).ok, false);
  assert.equal(reviewCode(reviewTestParent({ observation: observation(), productionMint: null, claimedDeployer: OTHER })), "deployer");
  assert.equal(reviewCode(reviewTestParent({ observation: observation({ mayhem: true }), productionMint: null, claimedDeployer: null })), "parent_ineligible");
  assert.equal(reviewCode(reviewTestParent({ observation: observation({ depth: 5 }), productionMint: null, claimedDeployer: null })), "parent_ineligible");
  assert.equal(
    reviewCode(reviewTestParent({
      observation: observation({ graduated: true, hasPool: false }),
      productionMint: null,
      claimedDeployer: null,
    })),
    "parent_ineligible",
  );
  assert.equal(reviewCode(reviewTestParent({ observation: observation({ source: "other" }), productionMint: null, claimedDeployer: null })), "parent_ineligible");
  assert.equal(reviewCode(reviewTestParent({ observation: observation({ holderReward: true }), productionMint: null, claimedDeployer: null })), "holder_rewards");
  assert.equal(reviewCode(reviewTestParent({ observation: observation({ feeMode: "fee_sharing" }), productionMint: null, claimedDeployer: null })), "fee_mode");
  assert.equal(
    reviewCode(reviewTestParent({
      observation: observation({ quoteMint: TREST }),
      productionMint: null,
      claimedDeployer: null,
    })),
    "quote",
  );
});

test("a test parent cannot replace the production parent", () => {
  const reviewed = reviewTestParent({
    observation: observation({ mint: PRODUCTION, creator: DEPLOYER }),
    productionMint: PRODUCTION,
    claimedDeployer: null,
  });
  assert.equal(reviewed.ok, false);
  if (reviewed.ok) return;
  assert.equal(reviewed.code, "production_parent");
  const selected = selectLaunchParent({
    audience: "operator",
    requestedScope: "test",
    requestedMint: PRODUCTION,
    productionMint: PRODUCTION,
    testParent: { mint: TREST, scope: "test", eligible: true },
  });
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.code, "production_parent");
});

test("production launch requests reject a TREST parent substitution", () => {
  assert.equal(parseParentObservationRequest({ mint: TREST, deployer: DEPLOYER }).ok, false);
  const substituted = publicLaunchScope({
    launchId: LAUNCH,
    mintPublicKey: MINT,
    parentMint: TREST,
    scope: "test",
  });
  assert.equal(substituted.ok, false);
  if (substituted.ok) return;
  assert.equal(substituted.code, "parent_scope");
  const selected = selectLaunchParent({
    audience: "public",
    requestedScope: "test",
    requestedMint: TREST,
    productionMint: PRODUCTION,
    testParent: { mint: TREST, scope: "test", eligible: true },
  });
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.code, "parent_scope");
  const production = publicLaunchScope({ launchId: LAUNCH, mintPublicKey: MINT });
  assert.equal(production.ok, true);
  if (!production.ok) return;
  assert.equal(production.scope, "production");
  assert.equal(production.launchId, LAUNCH);
  assert.equal(production.mintPublicKey, MINT);
});

test("an operator can bind TREST for preparation while execution stays closed", () => {
  const rehearsal = selectLaunchParent({
    audience: "operator",
    requestedScope: "test",
    requestedMint: TREST,
    productionMint: PRODUCTION,
    testParent: { mint: TREST, scope: "test", eligible: true },
  });
  assert.equal(rehearsal.ok, true);
  if (!rehearsal.ok) return;
  assert.equal(rehearsal.scope, "test");
  assert.equal(rehearsal.mint, TREST);
  assert.equal(rehearsal.executes, false);
  assert.equal("transaction" in rehearsal, false);
  const bound = bindLaunchParent(null, { parentMint: TREST, scope: "test" });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  const changed = bindLaunchParent(bound.binding, { parentMint: PRODUCTION, scope: "production" });
  assert.equal(changed.ok, false);
  if (changed.ok) return;
  assert.equal(changed.code, "parent_immutable");
  const graduated = reviewTestParent({
    observation: observation({ graduated: true, hasPool: true, pool: POOL }),
    productionMint: null,
    claimedDeployer: null,
  });
  assert.equal(graduated.ok, true);
});

test("test registration does not write the production parent table", () => {
  const source = readFileSync(new URL("../server/trest/register.ts", import.meta.url), "utf8");
  assert.equal(source.includes("sdk_parent_config"), false);
  assert.equal(source.includes("update parent_registrations"), false);
  assert.equal(source.includes("TREST_DEPLOYER_PRIVATE_KEY"), false);
});
