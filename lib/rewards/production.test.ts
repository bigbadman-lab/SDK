import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TREST_MINT, TOKEN_2022_PROGRAM } from "../launch/verified-launch.ts";
import { visibleCanonicalPhase } from "../sdk/official.ts";
import {
  PRODUCTION_ACTIVATION_APPROVAL,
  admitTick,
  presentProductionStatus,
  productionActivationPrerequisites,
  registrationFromParent,
  resolveProductionParent,
  workerConfirmsProductionRewards,
  type CanonicalParentConfig,
  type ProductionRegistration,
} from "./production.ts";

const MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SYSTEM = "11111111111111111111111111111111";
const DEPLOYER = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();

function registration(patch: Partial<ProductionRegistration> = {}): ProductionRegistration {
  return {
    scope: "production",
    symbol: "SDK",
    mint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    deployer: DEPLOYER,
    feeRecipient: DEPLOYER,
    feeMode: "single_recipient",
    quoteMint: SYSTEM,
    eligible: true,
    ...patch,
  };
}

function config(patch: Partial<CanonicalParentConfig> = {}): CanonicalParentConfig {
  return {
    mint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    rewardsActive: false,
    ...patch,
  };
}

test("an unregistered production mint fails closed", () => {
  assert.equal(resolveProductionParent({ registration: null, config: null, signerAddress: DEPLOYER }).ok, false);
  assert.equal(resolveProductionParent({ registration: null, config: config({ mint: null }), signerAddress: DEPLOYER }).ok, false);
  const missing = resolveProductionParent({ registration: registration(), config: config({ mint: null }), signerAddress: DEPLOYER });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.code, "unregistered");
});

test("a production mint that disagrees with the canonical config is rejected", () => {
  const mismatched = resolveProductionParent({
    registration: registration(),
    config: config({ mint: OTHER }),
    signerAddress: DEPLOYER,
  });
  assert.equal(mismatched.ok, false);
  if (mismatched.ok) return;
  assert.equal(mismatched.code, "mismatch");
  const program = resolveProductionParent({
    registration: registration(),
    config: config({ tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }),
    signerAddress: DEPLOYER,
  });
  assert.equal(program.ok, false);
  if (!program.ok) assert.equal(program.code, "mismatch");
  const decimals = resolveProductionParent({
    registration: registration(),
    config: config({ decimals: 9 }),
    signerAddress: DEPLOYER,
  });
  assert.equal(decimals.ok, false);
  if (!decimals.ok) assert.equal(decimals.code, "mismatch");
});

test("the historical TREST mint cannot resolve as the production parent", () => {
  const historical = resolveProductionParent({
    registration: registration({ scope: "test", symbol: "TREST", mint: TREST_MINT }),
    config: config({ mint: TREST_MINT }),
    signerAddress: DEPLOYER,
  });
  assert.equal(historical.ok, false);
  if (historical.ok) return;
  assert.equal(historical.code, "trest");
  const relabelled = resolveProductionParent({
    registration: registration({ mint: TREST_MINT }),
    config: config(),
    signerAddress: DEPLOYER,
  });
  assert.equal(relabelled.ok, false);
  if (!relabelled.ok) assert.equal(relabelled.code, "trest");
});

test("fee sharing, an ineligible parent, and a signer mismatch fail closed", () => {
  const shared = resolveProductionParent({
    registration: registration({ feeMode: "fee_sharing" }),
    config: config(),
    signerAddress: DEPLOYER,
  });
  assert.equal(shared.ok, false);
  if (!shared.ok) assert.equal(shared.code, "fee");
  const ineligible = resolveProductionParent({
    registration: registration({ eligible: false }),
    config: config(),
    signerAddress: DEPLOYER,
  });
  assert.equal(ineligible.ok, false);
  if (!ineligible.ok) assert.equal(ineligible.code, "ineligible");
  const signer = resolveProductionParent({
    registration: registration(),
    config: config({ rewardsActive: true }),
    signerAddress: OTHER,
  });
  assert.equal(signer.ok, false);
  if (!signer.ok) assert.equal(signer.code, "signer");
});

test("a matched inactive parent resolves without activating rewards", () => {
  const resolved = resolveProductionParent({
    registration: registrationFromParent({
      scope: "production",
      symbol: "SDK",
      mintAddress: MINT,
      tokenProgram: TOKEN_2022_PROGRAM,
      decimals: 6,
      deployerAddress: DEPLOYER,
      feeRecipientAddress: DEPLOYER,
      feeMode: "single_recipient",
      quoteMintAddress: SYSTEM,
      eligible: true,
    }),
    config: config(),
    signerAddress: DEPLOYER,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.mint, MINT);
  assert.equal(resolved.rewardsActive, false);
  assert.equal(resolved.deployer, DEPLOYER);
});

test("public status hides the signing key and does not treat a flag alone as broadcasts", () => {
  const idle = presentProductionStatus({
    canonicalMint: MINT,
    signer: "matched",
    rewardsActive: true,
    loopRunning: true,
    broadcastsEnabled: false,
    lastWindow: null,
    reconciliation: "clear",
    claimsReady: true,
  });
  assert.equal(idle.canonicalMint, MINT);
  assert.equal(idle.rewards, "active");
  assert.equal(idle.broadcasts, "disabled");
  assert.equal(idle.claims, "closed");
  assert.equal(JSON.stringify(idle).includes("PRIVATE"), false);
  const suspended = presentProductionStatus({
    canonicalMint: MINT,
    signer: "suspended",
    rewardsActive: true,
    loopRunning: false,
    broadcastsEnabled: true,
    lastWindow: "2026-10-26T16:00:00.000Z",
    reconciliation: "outstanding",
    claimsReady: true,
  });
  assert.equal(suspended.signer, "suspended");
  assert.equal(suspended.loop, "stopped");
  assert.equal(suspended.broadcasts, "disabled");
  assert.equal(suspended.claims, "closed");
  assert.equal(presentProductionStatus({
    canonicalMint: TREST_MINT,
    signer: "matched",
    rewardsActive: true,
    loopRunning: true,
    broadcastsEnabled: true,
    lastWindow: null,
    reconciliation: "unknown",
    claimsReady: true,
  }).canonicalMint, null);
});

test("the website stays registered until the worker confirms production broadcasts", () => {
  const hidden = visibleCanonicalPhase({ mint: MINT, decimals: 6, rewardsActive: true, workerReady: false });
  assert.equal(hidden.phase, "registered");
  const live = visibleCanonicalPhase({ mint: MINT, decimals: 6, rewardsActive: true, workerReady: true });
  assert.equal(live.phase, "live");
  assert.equal(workerConfirmsProductionRewards({
    runtime: "ready",
    executionAuthorised: true,
    production: { rewards: "active", broadcasts: "enabled" },
  }), true);
  assert.equal(workerConfirmsProductionRewards({ runtime: "ready", executionAuthorised: true }), false);
  assert.equal(workerConfirmsProductionRewards({
    runtime: "ready",
    executionAuthorised: true,
    production: { rewards: "active", broadcasts: "disabled" },
  }), false);
});

test("overlapping ticks and shutdown are refused before a second lease", () => {
  assert.equal(admitTick({ stopping: false, busy: false }), "run");
  assert.equal(admitTick({ stopping: false, busy: true }), "overlap");
  assert.equal(admitTick({ stopping: true, busy: false }), "shutdown");
});

test("stage-two activation stays behind an explicit approval and a healthy inactive worker", () => {
  const steps = productionActivationPrerequisites();
  assert.deepEqual(steps.map((step) => step.id), ["mint", "inactive", "worker", "health", "activate", "display"]);
  assert.equal(steps[1]?.requirement.includes("rewards_active is false"), true);
  assert.equal(steps[3]?.requirement.includes("broadcasts disabled"), true);
  assert.equal(steps[4]?.requirement.includes(PRODUCTION_ACTIVATION_APPROVAL), true);
  assert.equal(steps[5]?.requirement.includes("broadcasts enabled"), true);
});
