import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLATFORM_FEE_WALLET } from "./fees.ts";
import { TREST_MINT, TOKEN_2022_PROGRAM } from "./verified-launch.ts";
import {
  CHILD_FEE_DISABLE_APPROVAL,
  CHILD_FEE_ENABLE_APPROVAL,
  LAUNCH_ACTIVATION_APPROVAL,
  LAUNCH_CLOSE_APPROVAL,
  launchEmergencyCommands,
  parseLaunchActivationArgs,
  presentLaunchStatus,
  reviewLaunchActivation,
  runLaunchActivation,
  type LaunchControlSnapshot,
  type WorkerProbe,
} from "./launch-activation.ts";
import {
  broadcastPersistedChildIntent,
  persistedChildIntent,
  signedChildIntentBlocksRetry,
} from "../rewards/child-fee-gate.ts";

const MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SYSTEM = "11111111111111111111111111111111";
const REVISION = "ab".repeat(20);
const OTHER_REVISION = "cd".repeat(20);

function worker(patch: Partial<NonNullable<Extract<WorkerProbe, { ok: true }>["production"]>> = {}): WorkerProbe {
  return {
    ok: true,
    revision: REVISION,
    runtime: "ready",
    signer: "matched",
    executionAuthorised: true,
    production: {
      canonicalMint: MINT,
      signer: "matched",
      rewards: "inactive",
      loop: "running",
      broadcasts: "disabled",
      distributor: "present",
      childFees: "disabled",
      launches: "inactive",
      childFeeReconciliation: "clear",
      emergencyFence: "inactive",
      ...patch,
    },
  };
}

function snapshot(patch: Partial<LaunchControlSnapshot> = {}): LaunchControlSnapshot {
  return {
    database: "ok",
    config: {
      mint: MINT,
      tokenProgram: TOKEN_2022_PROGRAM,
      decimals: 6,
      rewardsActive: false,
      launchesActive: false,
      childFeesActive: false,
    },
    registration: {
      scope: "production",
      symbol: "SDK",
      mint: MINT,
      tokenProgram: TOKEN_2022_PROGRAM,
      decimals: 6,
      deployer: PLATFORM_FEE_WALLET,
      feeRecipient: PLATFORM_FEE_WALLET,
      feeMode: "single_recipient",
      quoteMint: SYSTEM,
      eligible: true,
    },
    chain: { ok: true, owner: TOKEN_2022_PROGRAM, decimals: 6 },
    signerAddress: PLATFORM_FEE_WALLET,
    builder: { ok: true, revision: REVISION, customQuote: "production", signing: false, broadcast: false },
    website: { ok: true, revision: REVISION, launchGate: "database", trestFallback: false, launches: "closed", canonicalMint: MINT },
    worker: worker(),
    unresolvedChildFees: 0,
    trestSuspended: true,
    trestRehearsalOpen: false,
    ...patch,
  };
}

function code(result: ReturnType<typeof reviewLaunchActivation>): string {
  return result.ok ? result.kind : result.code;
}

test("launch preflight blocks a missing or incorrect canonical parent and deployer", () => {
  assert.equal(code(reviewLaunchActivation(snapshot({ config: null, registration: null }), { action: "preflight", revision: REVISION })), "unregistered");
  assert.equal(code(reviewLaunchActivation(snapshot({
    config: { mint: OTHER, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: false, childFeesActive: false },
  }), { action: "preflight", revision: REVISION })), "mismatch");
  assert.equal(code(reviewLaunchActivation(snapshot({
    config: { mint: TREST_MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: false, childFeesActive: false },
    registration: { ...snapshot().registration!, mint: TREST_MINT },
  }), { action: "preflight", revision: REVISION })), "mismatch");
  assert.equal(code(reviewLaunchActivation(snapshot({ signerAddress: OTHER }), { action: "enable-child-fees", revision: REVISION })), "signer");
  assert.equal(code(reviewLaunchActivation(snapshot({ chain: { ok: true, owner: TOKEN_2022_PROGRAM, decimals: 9 } }), { action: "enable-child-fees", revision: REVISION })), "chain");
});

test("builder, website, and worker revisions are checked separately", () => {
  assert.equal(code(reviewLaunchActivation(snapshot({
    builder: { ok: true, revision: OTHER_REVISION, customQuote: "production", signing: false, broadcast: false },
  }), { action: "enable-child-fees", revision: REVISION })), "builder_revision");
  assert.equal(code(reviewLaunchActivation(snapshot({
    builder: { ok: true, revision: REVISION, signing: false, broadcast: false },
  }), { action: "enable-child-fees", revision: REVISION })), "builder_quote");
  assert.equal(code(reviewLaunchActivation(snapshot({
    website: { ok: true, revision: OTHER_REVISION, launchGate: "database", trestFallback: false, launches: "closed", canonicalMint: MINT },
  }), { action: "enable-child-fees", revision: REVISION })), "website_revision");
  const revised = worker();
  if (revised.ok) revised.revision = OTHER_REVISION;
  assert.equal(code(reviewLaunchActivation(snapshot({ worker: revised }), { action: "enable-child-fees", revision: REVISION })), "worker_revision");
  assert.equal(code(reviewLaunchActivation(snapshot({ worker: { ok: false, code: "unavailable" } }), { action: "enable-child-fees", revision: REVISION })), "worker_unavailable");
  assert.equal(code(reviewLaunchActivation(snapshot({ worker: worker({ signer: "suspended" }) }), { action: "enable-child-fees", revision: REVISION })), "signer");
  assert.equal(code(reviewLaunchActivation(snapshot({ worker: worker({ distributor: "" }) }), { action: "enable-child-fees", revision: REVISION })), "distributor");
});

test("stage 3 activation stays ready when parent rewards are already active", () => {
  const active = {
    mint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    rewardsActive: true,
    launchesActive: false,
    childFeesActive: false,
  };
  const enable = reviewLaunchActivation(snapshot({
    config: active,
    worker: worker({ rewards: "active" }),
  }), { action: "enable-child-fees", revision: REVISION });
  assert.equal(enable.ok, true);
  if (enable.ok) assert.equal(enable.kind, "ready");
  const open = reviewLaunchActivation(snapshot({
    config: { ...active, childFeesActive: true },
    worker: worker({ rewards: "active", childFees: "enabled" }),
  }), { action: "activate", revision: REVISION });
  assert.equal(open.ok, true);
  if (open.ok) assert.equal(open.kind, "ready");
  const cli = readFileSync(new URL("../../services/transaction-builder/src/sdk-launch-cli.ts", import.meta.url), "utf8");
  assert.equal(cli.includes("set rewards_active"), false);
  assert.match(cli, /rewards_active = \$\{config\.rewardsActive\}/);
});

test("child fees can be enabled while parent rewards stay inactive, and launches wait for that health", () => {
  const enable = reviewLaunchActivation(snapshot(), { action: "enable-child-fees", revision: REVISION });
  assert.equal(enable.ok, true);
  if (enable.ok) assert.equal(enable.kind, "ready");
  assert.equal(code(reviewLaunchActivation(snapshot({ worker: worker({ childFees: "disabled" }) }), { action: "preflight", revision: REVISION })), "child_fees_inactive");
  const armed = snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: false, childFeesActive: true },
    worker: worker({ childFees: "enabled" }),
  });
  const open = reviewLaunchActivation(armed, { action: "activate", revision: REVISION });
  assert.equal(open.ok, true);
  if (open.ok) assert.equal(open.kind, "ready");
  assert.equal(code(reviewLaunchActivation(snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: false, childFeesActive: true },
  }), { action: "activate", revision: REVISION })), "child_fees_inactive");
  assert.equal(code(reviewLaunchActivation(armed, { action: "enable-child-fees", revision: REVISION })), "idempotent");
  const live = snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: true, childFeesActive: true },
    website: { ok: true, revision: REVISION, launchGate: "database", trestFallback: false, launches: "active", canonicalMint: MINT },
    worker: worker({ childFees: "enabled", launches: "active" }),
  });
  assert.equal(code(reviewLaunchActivation(live, { action: "activate", revision: REVISION })), "idempotent");
  assert.equal(code(reviewLaunchActivation(snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: true, childFeesActive: true },
    worker: worker({ childFees: "enabled", launches: "inactive" }),
  }), { action: "activate", revision: REVISION })), "service_unready");
});

test("emergency closure does not require a live worker and repeated closure is idempotent", () => {
  const open = snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true, launchesActive: true, childFeesActive: true },
    worker: { ok: false, code: "unavailable" },
  });
  assert.equal(code(reviewLaunchActivation(open, { action: "close-launches", revision: REVISION })), "ready");
  assert.equal(code(reviewLaunchActivation(open, { action: "disable-child-fees", revision: REVISION })), "ready");
  const closed = snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true, launchesActive: false, childFeesActive: false },
    worker: { ok: false, code: "unavailable" },
  });
  assert.equal(code(reviewLaunchActivation(closed, { action: "close-launches", revision: REVISION })), "idempotent");
  assert.equal(code(reviewLaunchActivation(closed, { action: "disable-child-fees", revision: REVISION })), "idempotent");
  const commands = launchEmergencyCommands().map((item) => item.command);
  assert.equal(commands.some((command) => command.includes(LAUNCH_CLOSE_APPROVAL)), true);
  assert.equal(commands.some((command) => command.includes(CHILD_FEE_DISABLE_APPROVAL)), true);
});

test("a disarmed worker cannot enable child fees or open launches", () => {
  const disarmed = snapshot({ worker: worker({ loop: "stopped" }) });
  if (disarmed.worker.ok) disarmed.worker.executionAuthorised = false;
  assert.equal(code(reviewLaunchActivation(disarmed, { action: "enable-child-fees", revision: REVISION })), "worker_execution");
  assert.equal(code(reviewLaunchActivation(disarmed, { action: "activate", revision: REVISION })), "worker_execution");
  assert.equal(code(reviewLaunchActivation(snapshot({
    worker: worker({ emergencyFence: "active" }),
    unresolvedChildFees: 1,
  }), { action: "enable-child-fees", revision: REVISION })), "fence");
  assert.equal(code(reviewLaunchActivation(snapshot({ trestSuspended: false }), { action: "enable-child-fees", revision: REVISION })), "trest");
  assert.equal(code(reviewLaunchActivation(snapshot({ unresolvedChildFees: 2 }), { action: "enable-child-fees", revision: REVISION })), "reconciliation");
  assert.equal(code(reviewLaunchActivation(snapshot({ database: "unavailable" }), { action: "activate", revision: REVISION })), "database");
});

test("dry-run writes nothing and execute follows child fees before launches", async () => {
  const calls: string[] = [];
  const base = snapshot();
  let current = base;
  const result = await runLaunchActivation(["node", "cli", "--enable-child-fees", "--revision", REVISION], {
    snapshot: async () => current,
    commitChildFees: async () => {
      calls.push("child");
      return "ok";
    },
    commitLaunches: async () => {
      calls.push("launch");
      return "ok";
    },
    closeLaunches: async () => "blocked",
    disableChildFees: async () => "blocked",
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /^preflight/);
  assert.equal(calls.length, 0);
  assert.equal(parseLaunchActivationArgs(["node", "cli", "--execute", "--approval", "nope", "--revision", REVISION]).ok, false);
  assert.equal(parseLaunchActivationArgs(["node", "cli", "--enable-child-fees", "--execute", "--approval", LAUNCH_ACTIVATION_APPROVAL, "--revision", REVISION]).ok, false);
  const enabled = parseLaunchActivationArgs(["node", "cli", "--enable-child-fees", "--execute", "--approval", CHILD_FEE_ENABLE_APPROVAL, "--revision", REVISION]);
  assert.equal(enabled.ok, true);
  let phase = 0;
  const pending = await runLaunchActivation(["node", "cli", "--enable-child-fees", "--execute", "--approval", CHILD_FEE_ENABLE_APPROVAL, "--revision", REVISION], {
    snapshot: async () => {
      phase += 1;
      if (phase === 1) return snapshot();
      return snapshot({
        config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false, launchesActive: false, childFeesActive: true },
        worker: worker({ childFees: "disabled" }),
      });
    },
    commitChildFees: async () => {
      calls.push("child");
      return "ok";
    },
    commitLaunches: async () => {
      calls.push("launch");
      return "ok";
    },
    closeLaunches: async () => "blocked",
    disableChildFees: async () => "blocked",
  });
  assert.equal(pending.code, 2);
  assert.match(pending.out, /code=child_fees_pending/);
  assert.match(pending.out, /writes=1/);
  assert.deepEqual(calls, ["child"]);
  const opened = await runLaunchActivation(["node", "cli", "--execute", "--approval", LAUNCH_ACTIVATION_APPROVAL, "--revision", REVISION], {
    snapshot: async () => snapshot(),
    commitChildFees: async () => "ok",
    commitLaunches: async () => {
      calls.push("launch");
      return "ok";
    },
    closeLaunches: async () => "blocked",
    disableChildFees: async () => "blocked",
  });
  assert.equal(opened.code, 2);
  assert.match(opened.out, /code=child_fees_inactive/);
  assert.equal(calls.includes("launch"), false);
  const status = presentLaunchStatus(snapshot(), REVISION);
  assert.match(status.out, /canonical=registered/);
  assert.match(status.out, /rewards=inactive/);
  assert.match(status.out, /child_fees=disabled/);
  assert.match(status.out, /launches=closed/);
  assert.match(status.out, /website_revision=abababababababababababababababababababab/);
  assert.match(status.out, /builder_revision=abababababababababababababababababababab/);
  assert.match(status.out, /worker_revision=abababababababababababababababababababab/);
  assert.match(status.out, /signer=matched/);
  assert.match(status.out, /emergency_fence=inactive/);
  assert.equal(status.out.includes("PRIVATE"), false);
});

test("a signed child-fee intent is withheld unless this attempt claimed the recorded row", () => {
  assert.equal(persistedChildIntent(null), "insert");
  assert.equal(persistedChildIntent({ status: "recorded", signature: null }), "claim");
  assert.equal(persistedChildIntent({ status: "submitted", signature: "sig" }), "withhold");
  assert.equal(persistedChildIntent({ status: "uncertain", signature: "sig" }), "withhold");
  assert.equal(persistedChildIntent({ status: "unreconciled", signature: "sig" }), "withhold");
  assert.equal(broadcastPersistedChildIntent({ claimed: true, shuttingDown: false }), true);
  assert.equal(broadcastPersistedChildIntent({ claimed: true, shuttingDown: true }), false);
  assert.equal(broadcastPersistedChildIntent({ claimed: false, shuttingDown: false }), false);
  assert.equal(signedChildIntentBlocksRetry("submitted"), true);
  assert.equal(signedChildIntentBlocksRetry("recorded"), false);
  const source = readFileSync(new URL("../../services/rewards-worker/src/production-child-fees.ts", import.meta.url), "utf8");
  const recorded = source.indexOf("'recorded', null");
  const claimed = source.indexOf("status = 'submitted', signature");
  const submit = source.lastIndexOf("input.chain.submit");
  assert.ok(recorded > 0 && recorded < claimed && claimed < submit);
  assert.ok(source.lastIndexOf("shutdownRequested()", submit) < submit);
  assert.match(source, /scope = 'production'/);
  assert.equal(source.includes("rewards_active"), false);
  const cli = readFileSync(new URL("../../services/transaction-builder/src/sdk-launch-cli.ts", import.meta.url), "utf8");
  assert.match(cli, /pg_advisory_xact_lock/);
  assert.equal(cli.includes("set rewards_active"), false);
  assert.equal(cli.includes("signTransaction"), false);
  assert.equal(cli.includes("SDK_DEPLOYER_PRIVATE_KEY"), true);
  assert.match(cli, /delete process\.env\.SDK_DEPLOYER_PRIVATE_KEY/);
});
