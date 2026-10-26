import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TREST_MINT, TOKEN_2022_PROGRAM } from "../launch/verified-launch.ts";
import {
  emergencyStopProcedure,
  parseActivationArgs,
  parseWorkerHealth,
  presentRewardsStatus,
  rewardsAreLive,
  reviewActivation,
  reviewRewardsDeactivation,
  runActivation,
  type ActivationSnapshot,
  type ActivationWorker,
} from "./activation.ts";
import { PRODUCTION_ACTIVATION_APPROVAL, PRODUCTION_DEACTIVATION_APPROVAL, type ProductionRegistration } from "./production.ts";

const MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const SYSTEM = "11111111111111111111111111111111";
const DEPLOYER = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
const REVISION = "ab".repeat(20);

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

function worker(patch: Partial<ActivationWorker> = {}): ActivationWorker {
  return {
    ok: true,
    service: "rewards-worker",
    runtime: "ready",
    signer: "matched",
    executionAuthorised: true,
    revision: REVISION,
    production: {
      canonicalMint: MINT,
      signer: "matched",
      rewards: "inactive",
      loop: "running",
      broadcasts: "disabled",
      lastWindow: null,
      reconciliation: "clear",
      claims: "closed",
    },
    ...patch,
  };
}

function snapshot(patch: Partial<ActivationSnapshot> = {}): ActivationSnapshot {
  return {
    database: "ok",
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false },
    registration: registration(),
    chain: { ok: true, owner: TOKEN_2022_PROGRAM, decimals: 6 },
    signerAddress: DEPLOYER,
    worker: worker(),
    unresolved: 0,
    lastWindow: null,
    childLaunchesOpen: false,
    trestSuspended: true,
    trestRehearsalOpen: false,
    ...patch,
  };
}

test("activation args stay read-only until execute and the approval token", () => {
  assert.equal(parseActivationArgs(["node", "cli", "--revision", REVISION]).ok, true);
  const dry = parseActivationArgs(["node", "cli", `--revision=${REVISION}`]);
  assert.equal(dry.ok, true);
  if (dry.ok) assert.equal(dry.mode, "dry-run");
  const execute = parseActivationArgs(["node", "cli", "--execute", "--approval", PRODUCTION_ACTIVATION_APPROVAL, "--revision", REVISION]);
  assert.equal(execute.ok, true);
  if (execute.ok) assert.equal(execute.mode, "execute");
  assert.equal(parseActivationArgs(["node", "cli", "--execute", "--revision", REVISION]).ok, false);
  assert.equal(parseActivationArgs(["node", "cli", "--execute", "--approval", "nope", "--revision", REVISION]).ok, false);
  assert.equal(parseActivationArgs(["node", "cli", "--mint", MINT, "--revision", REVISION]).ok, false);
  assert.equal(parseActivationArgs(["node", "cli"]).ok, false);
  const stop = parseActivationArgs(["node", "cli", "--deactivate", "--revision", REVISION]);
  assert.equal(stop.ok, true);
  if (stop.ok) {
    assert.equal(stop.action, "deactivate");
    assert.equal(stop.mode, "dry-run");
  }
  const wrong = parseActivationArgs(["node", "cli", "--deactivate", "--execute", "--approval", PRODUCTION_ACTIVATION_APPROVAL, "--revision", REVISION]);
  assert.equal(wrong.ok, false);
  const approved = parseActivationArgs(["node", "cli", "--deactivate", "--execute", "--approval", PRODUCTION_DEACTIVATION_APPROVAL, "--revision", REVISION]);
  assert.equal(approved.ok, true);
  if (approved.ok) assert.equal(approved.mode, "execute");
});

test("parent rewards can be deactivated while the worker is unavailable", async () => {
  const active = snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true },
    worker: { ok: false, code: "unavailable" },
    chain: { ok: false, code: "unavailable" },
    unresolved: null,
  });
  const review = reviewRewardsDeactivation(active);
  assert.equal(review.ok, true);
  if (review.ok) assert.equal(review.kind, "ready");
  assert.equal(reviewRewardsDeactivation(snapshot({ config: null, registration: null })).ok, false);
  const divergent = reviewRewardsDeactivation(snapshot({
    config: { mint: OTHER, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true },
    worker: { ok: false, code: "unavailable" },
  }));
  assert.equal(divergent.ok, false);
  if (!divergent.ok) assert.equal(divergent.code, "mismatch");
  let writes = 0;
  const dry = await runActivation(["node", "cli", "--deactivate", "--revision", REVISION], {
    snapshot: async () => active,
    commit: async () => {
      writes += 1;
      return "ok";
    },
    commitDeactivate: async () => {
      writes += 1;
      return "ok";
    },
  });
  assert.equal(dry.code, 0);
  assert.equal(writes, 0);
  assert.match(dry.out, /preflight/);
  assert.match(dry.out, /writes=0/);
  assert.match(dry.out, /rewards=active/);
  assert.match(dry.out, /submitted=preserved/);
  const stopped = await runActivation(
    ["node", "cli", "--deactivate", "--execute", "--approval", PRODUCTION_DEACTIVATION_APPROVAL, "--revision", REVISION],
    {
      snapshot: async () => active,
      commit: async () => "ok",
      commitDeactivate: async (mint) => {
        assert.equal(mint, MINT);
        writes += 1;
        return "ok";
      },
    },
  );
  assert.equal(stopped.code, 0);
  assert.equal(writes, 1);
  assert.match(stopped.out, /^deactivated/);
  assert.match(stopped.out, /rewards=inactive/);
  assert.match(stopped.out, /writes=1/);
  const again = await runActivation(
    ["node", "cli", "--deactivate", "--execute", "--approval", PRODUCTION_DEACTIVATION_APPROVAL, "--revision", REVISION],
    {
      snapshot: async () => snapshot({ worker: { ok: false, code: "unavailable" } }),
      commit: async () => "ok",
      commitDeactivate: async () => "idempotent",
    },
  );
  assert.equal(again.code, 0);
  assert.match(again.out, /verification=idempotent/);
  assert.match(again.out, /writes=0/);
  assert.match(again.out, /rewards=inactive/);
});

test("preflight accepts a matched inactive parent and rejects the launch blockers", () => {
  const ready = reviewActivation(snapshot(), REVISION);
  assert.equal(ready.ok, true);
  if (ready.ok) assert.equal(ready.kind, "ready");
  assert.equal(reviewActivation(snapshot({ config: null, registration: null }), REVISION).ok, false);
  const mismatch = reviewActivation(snapshot({ config: { mint: OTHER, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false } }), REVISION);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "mismatch");
  const chain = reviewActivation(snapshot({ chain: { ok: true, owner: TOKEN_2022_PROGRAM, decimals: 9 } }), REVISION);
  assert.equal(chain.ok, false);
  if (!chain.ok) assert.equal(chain.code, "chain");
  const shared = reviewActivation(snapshot({ registration: registration({ feeMode: "fee_sharing" }) }), REVISION);
  assert.equal(shared.ok, false);
  if (!shared.ok) assert.equal(shared.code, "fee");
  const signer = reviewActivation(snapshot({ signerAddress: OTHER }), REVISION);
  assert.equal(signer.ok, false);
  if (!signer.ok) assert.equal(signer.code, "signer");
  const suspended = reviewActivation(snapshot({ worker: worker({ signer: "suspended", production: { ...worker().production!, signer: "suspended" } }) }), REVISION);
  assert.equal(suspended.ok, false);
  if (!suspended.ok) assert.equal(suspended.code, "signer");
  const down = reviewActivation(snapshot({ worker: { ok: false, code: "unavailable" } }), REVISION);
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.code, "worker_unavailable");
  const revision = reviewActivation(snapshot(), "cd".repeat(20));
  assert.equal(revision.ok, false);
  if (!revision.ok) assert.equal(revision.code, "worker_revision");
  const open = reviewActivation(snapshot({ unresolved: 2 }), REVISION);
  assert.equal(open.ok, false);
  if (!open.ok) assert.equal(open.code, "reconciliation");
  const children = reviewActivation(snapshot({ childLaunchesOpen: true }), REVISION);
  assert.equal(children.ok, false);
  if (!children.ok) assert.equal(children.code, "child_launches");
  const trest = reviewActivation(snapshot({ trestRehearsalOpen: true }), REVISION);
  assert.equal(trest.ok, false);
  if (!trest.ok) assert.equal(trest.code, "trest");
  const historical = reviewActivation(snapshot({
    config: { mint: TREST_MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: false },
    registration: registration({ mint: TREST_MINT }),
  }), REVISION);
  assert.equal(historical.ok, false);
});

test("an already active parent is idempotent and a database flag alone is not live", () => {
  const active = reviewActivation(snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true },
    worker: worker({
      production: { ...worker().production!, rewards: "active", broadcasts: "enabled", claims: "ready" },
    }),
  }), REVISION);
  assert.equal(active.ok, true);
  if (active.ok) assert.equal(active.kind, "idempotent");
  const live = rewardsAreLive({
    rewardsActive: true,
    worker: worker({ production: { ...worker().production!, rewards: "inactive", broadcasts: "disabled" } }),
  });
  assert.equal(live, false);
  const confirmed = rewardsAreLive({
    rewardsActive: true,
    worker: worker({
      runtime: "ready",
      executionAuthorised: true,
      production: { ...worker().production!, rewards: "active", broadcasts: "enabled", claims: "ready" },
    }),
  });
  assert.equal(confirmed, true);
});

test("dry-run writes nothing, execute commits once, and a failed write stays closed", async () => {
  let writes = 0;
  const io = {
    snapshot: async () => snapshot(),
    commit: async () => {
      writes += 1;
      return "ok" as const;
    },
  };
  const argv = ["node", "sdk:activate-rewards", "--revision", REVISION];
  const dry = await runActivation(argv, io);
  assert.equal(writes, 0);
  assert.match(dry.out, /preflight/);
  assert.match(dry.out, /writes=0/);
  assert.match(dry.out, /rewards_live=false/);
  const executed = await runActivation([...argv, "--execute", "--approval", PRODUCTION_ACTIVATION_APPROVAL], io);
  assert.equal(writes, 1);
  assert.match(executed.out, /activated/);
  assert.match(executed.out, /writes=1/);
  assert.match(executed.out, /rewards_live=false/);
  const failed = await runActivation([...argv, "--execute", "--approval", PRODUCTION_ACTIVATION_APPROVAL], {
    snapshot: async () => snapshot(),
    commit: async () => "rolled_back",
  });
  assert.equal(failed.code, 2);
  assert.match(failed.out, /code=rolled_back/);
  assert.match(failed.out, /writes=0/);
  const denied = await runActivation(["node", "cli", "--execute", "--approval", "nope", "--revision", REVISION], io);
  assert.equal(denied.code, 2);
  assert.match(denied.out, /code=approval/);
  assert.equal(writes, 1);
});

test("status keeps a registered active flag dark until the worker confirms broadcasts", () => {
  const status = presentRewardsStatus(snapshot({
    config: { mint: MINT, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, rewardsActive: true },
  }));
  assert.match(status.out, /canonical_mint=registered/);
  assert.match(status.out, /database_rewards=active/);
  assert.match(status.out, /financial=disabled/);
  assert.match(status.out, /rewards_live=false/);
  assert.match(status.out, /child_launches=closed/);
  assert.match(status.out, /trest=inactive/);
  const down = presentRewardsStatus(snapshot({ worker: { ok: false, code: "unavailable" } }));
  assert.match(down.out, /worker=unavailable/);
  assert.match(down.out, /rewards_live=false/);
  const parsed = parseWorkerHealth({ service: "rewards-worker", ok: true, signer: "matched", secret: "hidden-key" });
  assert.equal(parsed.ok, true);
  assert.equal(JSON.stringify(parsed).includes("hidden-key"), false);
});

test("emergency stop preserves pending reconciliation and holder entitlements", () => {
  const steps = emergencyStopProcedure().map((step) => `${step.step} ${step.effect}`).join(" ");
  assert.match(steps, /SDK-PROD-03-CLOSE-LAUNCHES/);
  assert.match(steps, /SDK-PROD-03-DISABLE-CHILD-FEES/);
  assert.match(steps, /SDK-PROD-02-DEACTIVATE/);
  assert.match(steps, /does not cancel an already submitted blockchain transaction/);
  assert.match(steps, /new deploy/i);
  assert.match(steps, /restart/);
  assert.match(steps, /idempotency keys/);
  assert.match(steps, /not deleted/);
  const source = readFileSync(new URL("../../services/transaction-builder/src/sdk-activate-cli.ts", import.meta.url), "utf8");
  assert.equal(source.includes("delete process.env.SDK_DEPLOYER_PRIVATE_KEY"), true);
  assert.equal(source.includes("insert into parent_registrations"), false);
  assert.equal(source.includes("insert into sdk_parent_config"), false);
  assert.match(source, /set rewards_active = true/);
  assert.match(source, /set rewards_active = false/);
  assert.equal(source.includes("set launches_active"), false);
  assert.equal(source.includes("set child_fees_active"), false);
  assert.equal(source.includes("set mint_address"), false);
  assert.equal(source.includes("signInspected"), false);
  assert.equal(source.includes(".submit("), false);
  const status = readFileSync(new URL("../../services/transaction-builder/src/sdk-rewards-status-cli.ts", import.meta.url), "utf8");
  assert.equal(status.includes("update "), false);
  assert.equal(status.includes("insert into"), false);
});
