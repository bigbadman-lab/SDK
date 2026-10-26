import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "./fees.ts";
import { LAUNCH_ACTIVATION_APPROVAL, launchActivationContract, parseLaunchActivationArgs } from "./launch-activation.ts";
import type { ParentObservation } from "./parent.ts";
import { publicLaunchScope } from "./parent-scope.ts";
import { productionSignAllowed } from "./production-launch.ts";
import { acceptCanonicalLaunchParent } from "./production-parent.ts";
import { closedLaunchCopy, decidePublicLaunchGate, publicRecoveryAdmission } from "./public-gate.ts";
import { TREST_MINT } from "./verified-launch.ts";

const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const LAUNCHER = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";
const ORIGINATOR = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";

function observed(mint: string): ParentObservation {
  return {
    mint,
    creator: LAUNCHER,
    feeMode: "holder_rewards",
    quoteMint: "11111111111111111111111111111111",
    tokenProgram: TOKEN,
    decimals: 6,
    mayhem: false,
    cashback: false,
    holderReward: true,
    depth: 1,
    maxCurveDepth: 5,
    graduated: false,
    hasPool: false,
    bondingCurve: null,
    pool: null,
    source: "pumpCoin",
  };
}

test("a missing parent, a missing flag, and the environment variable stay closed", () => {
  assert.equal(decidePublicLaunchGate({
    present: false,
    mint: null,
    launchesActive: null,
    rewardsActive: false,
    schema: "ready",
  }).availability, "unregistered");
  assert.equal(decidePublicLaunchGate({
    present: true,
    mint: SDK,
    launchesActive: null,
    rewardsActive: true,
    schema: "ready",
  }).open, false);
  const inactive = decidePublicLaunchGate({
    present: true,
    mint: SDK,
    launchesActive: false,
    rewardsActive: true,
    schema: "ready",
  });
  assert.equal(inactive.availability, "inactive");
  assert.equal(inactive.rewardsActive, true);
  assert.equal(inactive.open, false);
  const open = decidePublicLaunchGate({
    present: true,
    mint: SDK,
    launchesActive: true,
    rewardsActive: false,
    schema: "ready",
  });
  assert.equal(open.availability, "open");
  assert.equal(open.rewardsActive, false);
  assert.equal(open.open, true);
  assert.equal(decidePublicLaunchGate({
    present: false,
    mint: null,
    launchesActive: null,
    rewardsActive: false,
    schema: "missing",
  }).availability, "unavailable");
  assert.equal(decidePublicLaunchGate({
    present: true,
    mint: TREST_MINT,
    launchesActive: true,
    rewardsActive: false,
    schema: "ready",
  }).availability, "unregistered");
  const source = readFileSync(new URL("./public-gate.ts", import.meta.url), "utf8");
  assert.equal(source.includes("PUBLIC_CHILD_LAUNCHES"), false);
});

test("closure blocks a new build and preserves reconciliation of an existing submission", () => {
  assert.equal(publicRecoveryAdmission({ gateOpen: false, submissionFound: false }), "closed");
  assert.equal(publicRecoveryAdmission({ gateOpen: false, submissionFound: true }), "reconcile");
  assert.equal(publicRecoveryAdmission({ gateOpen: true, submissionFound: false }), "ready_to_build");
  const build = readFileSync(new URL("../../app/api/launch/build/route.ts", import.meta.url), "utf8");
  const submit = readFileSync(new URL("../../app/api/launch/submit/route.ts", import.meta.url), "utf8");
  const recover = readFileSync(new URL("../../app/api/launch/recover/route.ts", import.meta.url), "utf8");
  const preflight = readFileSync(new URL("../../app/api/launch/preflight/route.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../../app/api/admin/trest/build/route.ts", import.meta.url), "utf8");
  assert.match(build, /readPublicLaunchGate\(\)/);
  assert.match(submit, /if \(!gate\.open\)/);
  assert.equal(submit.includes("submitSignedLaunch"), true);
  assert.ok(submit.indexOf("if (!gate.open)") < submit.indexOf("await submitSignedLaunch"));
  assert.match(recover, /publicRecoveryAdmission/);
  assert.match(recover, /recoverSignedLaunch/);
  assert.ok(recover.indexOf("await recoverSignedLaunch") < recover.indexOf("publicRecoveryAdmission({"));
  assert.match(build, /publicLaunchScope/);
  assert.match(build, /launchJson/);
  const response = readFileSync(new URL("../server/launch/response.ts", import.meta.url), "utf8");
  assert.match(response, /"cache-control": "private, no-store"/);
  assert.match(preflight, /l\.parent_scope = 'production'/);
  assert.match(preflight, /submitted: false/);
  assert.match(admin, /publicChildLaunchesOpen/);
  assert.match(admin, /isProvisionedOperator/);
  assert.equal(admin.includes("readPublicLaunchGate"), false);
});

test("a historical TREST mint and a client quote cannot satisfy the production parent", () => {
  const rejected = acceptCanonicalLaunchParent({
    configMint: TREST_MINT,
    configProgram: TOKEN,
    configDecimals: 6,
    observed: observed(TREST_MINT),
    buildParentMint: TREST_MINT,
  });
  assert.equal(rejected.ok, false);
  const mismatch = acceptCanonicalLaunchParent({
    configMint: SDK,
    configProgram: TOKEN,
    configDecimals: 6,
    observed: observed(SDK),
    buildParentMint: TREST_MINT,
  });
  assert.equal(mismatch.ok, false);
  const program = acceptCanonicalLaunchParent({
    configMint: SDK,
    configProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    configDecimals: 6,
    observed: observed(SDK),
    buildParentMint: SDK,
  });
  assert.equal(program.ok, false);
  const accepted = acceptCanonicalLaunchParent({
    configMint: SDK,
    configProgram: TOKEN,
    configDecimals: 6,
    observed: observed(SDK),
    buildParentMint: SDK,
  });
  assert.equal(accepted.ok, true);
  const override = publicLaunchScope({
    launchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mintPublicKey: LAUNCHER,
    quoteMint: TREST_MINT,
  });
  assert.equal(override.ok, false);
  const assemble = readFileSync(new URL("../../services/transaction-builder/src/assemble.ts", import.meta.url), "utf8");
  assert.match(assemble, /quoteMint: input\.parentMint/);
  assert.match(assemble, /lookupTables: 0/);
  assert.match(assemble, /buyAt !== roles\.length - 1/);
  assert.match(assemble, /createV2Instruction/);
});

test("fee schedules, signing, and the public screen stay server-controlled", () => {
  const official = allocateCreatorFees({
    category: "official",
    launcherWallet: LAUNCHER,
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  const originator = allocateCreatorFees({
    category: "originator_launch",
    launcherWallet: LAUNCHER,
    originatorWallet: LAUNCHER,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  const community = allocateCreatorFees({
    category: "community_split",
    launcherWallet: LAUNCHER,
    originatorWallet: ORIGINATOR,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  assert.equal(official.ok && official.shareholders.find((row) => row.address === LAUNCHER)?.shareBps, 6000);
  assert.equal(official.ok && official.shareholders.find((row) => row.address === PLATFORM_FEE_WALLET)?.shareBps, 4000);
  assert.equal(originator.ok && originator.shareholders.find((row) => row.address === LAUNCHER)?.shareBps, 8500);
  assert.equal(community.ok && community.shareholders.find((row) => row.address === ORIGINATOR)?.shareBps, 2500);
  assert.equal(community.ok && community.shareholders.find((row) => row.address === PLATFORM_FEE_WALLET)?.shareBps, 1500);
  assert.equal(productionSignAllowed({
    gateOpen: false,
    parentIsCanonical: true,
    persistenceReady: true,
    committedHash: "ab",
    preflightHash: "ab",
    mintAvailable: true,
  }).reason, "closed");
  assert.equal(productionSignAllowed({
    gateOpen: true,
    parentIsCanonical: true,
    persistenceReady: true,
    committedHash: "ab",
    preflightHash: "cd",
    mintAvailable: true,
  }).reason, "preflight");
  assert.equal(productionSignAllowed({
    gateOpen: true,
    parentIsCanonical: true,
    persistenceReady: true,
    committedHash: "ab",
    preflightHash: "ab",
    mintAvailable: false,
  }).reason, "mint_lost");
  const actions = readFileSync(new URL("../../components/launch/production-actions.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/launch/page.tsx", import.meta.url), "utf8");
  assert.match(actions, /\/api\/launch\/build/);
  assert.match(actions, /\/api\/launch\/submit/);
  assert.match(actions, /\/api\/launch\/recover/);
  assert.match(actions, /finishLaunchSignatures/);
  assert.match(actions, /requestPhantomSignature/);
  assert.match(actions, /held\.discard\(\)/);
  assert.match(actions, /review\.feeLabel/);
  assert.equal(actions.includes("/api/admin/trest"), false);
  assert.equal(actions.includes("console."), false);
  assert.match(actions, /recoveryPhase/);
  assert.match(form, /availability === "open"/);
  assert.match(form, /phase="unavailable"/);
  assert.match(form, /disabled/);
  assert.match(page, /readPublicLaunchGate/);
  assert.equal(page.includes("TREST"), false);
  assert.equal(closedLaunchCopy("unregistered").includes("registered"), true);
  assert.equal(closedLaunchCopy("inactive").includes("not active"), true);
  assert.equal(closedLaunchCopy("unavailable").includes("unavailable"), true);
  assert.equal(closedLaunchCopy("open").includes("canonical"), true);
});

test("activation stays read-only until the exact approval and revision", () => {
  const revision = "ab".repeat(20);
  assert.equal(parseLaunchActivationArgs(["node", "cli"]).ok, false);
  assert.equal(parseLaunchActivationArgs(["node", "cli", "--execute"]).ok, false);
  assert.equal(parseLaunchActivationArgs(["node", "cli", "--execute", "--approval", LAUNCH_ACTIVATION_APPROVAL]).ok, false);
  const dry = parseLaunchActivationArgs(["node", "cli", "--revision", revision]);
  assert.equal(dry.ok, true);
  if (dry.ok) assert.equal(dry.mode, "dry-run");
  const execute = parseLaunchActivationArgs(["node", "cli", "--execute", "--approval", LAUNCH_ACTIVATION_APPROVAL, "--revision", revision]);
  assert.equal(execute.ok, true);
  if (execute.ok) assert.equal(execute.mode, "execute");
  const contract = launchActivationContract();
  assert.equal(contract.some((step) => step.id === "child_fee_distributor"), true);
  assert.equal(contract.some((step) => step.id === "emergency_close"), true);
  assert.equal(contract.some((step) => step.requirement.includes(LAUNCH_ACTIVATION_APPROVAL)), true);
  const migration = readFileSync(new URL("../../supabase/migrations/20261026200000_sdk_prod_03b_launches_active.sql", import.meta.url), "utf8");
  assert.match(migration, /add column launches_active boolean not null default false/);
  assert.match(migration, /launches_active = false or mint_address is not null/);
  assert.equal(migration.includes("launches_active = true"), false);
  assert.equal(migration.includes("insert into"), false);
  assert.equal(migration.includes(TREST_MINT), false);
  const registrar = readFileSync(new URL("../../services/transaction-builder/src/sdk-register-cli.ts", import.meta.url), "utf8");
  assert.match(registrar, /launches_active = false|launches_active, false/);
});
