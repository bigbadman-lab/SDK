import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseRehearsalBuildRequest } from "./builder-request.ts";
import { LAUNCH_PRIORITY_FEE_LAMPORTS, networkCostCopy } from "./cost.ts";
import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "./fees.ts";
import { publicLaunchScope, selectLaunchParent } from "./parent-scope.ts";
import { rehearsalSignAllowed } from "./rehearsal-flow.ts";
import { noteBroadcast } from "./submission.ts";
import {
  TOKEN_2022_PROGRAM,
  TREST_MINT,
  audiencePair,
  launchByMint,
  launchesForCreator,
  presentVerifiedLaunch,
  uniqueLaunches,
  verificationStamp,
  type VerifiedLaunchSource,
} from "./verified-launch.ts";
import { V1_ACCOUNT_LIMIT, V1_COMPUTE_UNIT_LIMIT, V1_PACKET_LIMIT_BYTES, V1_PRIORITY_FEE_LAMPORTS } from "../../services/transaction-builder/src/v1.ts";

const LAUNCHER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const ORIGINATOR = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const CHILD = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";

function source(patch: Partial<VerifiedLaunchSource> = {}): VerifiedLaunchSource {
  return {
    status: "verified",
    slot: "44",
    verifiedAt: "2026-10-22T09:00:00.000Z",
    scope: "test",
    parentSymbol: "TREST",
    childMint: CHILD,
    parentMint: TREST_MINT,
    name: "Lesson",
    symbol: "LESSON",
    imageUrl: "https://example.test/lesson.png",
    sdkName: "Lesson SDK",
    librarySdkId: "22222222-2222-4222-8222-222222222222",
    creator: LAUNCHER,
    originatorLabel: "Originator",
    signature: "2".repeat(88),
    ...patch,
  };
}

test("operator TREST signing stays closed for everyone else", () => {
  assert.equal(rehearsalSignAllowed({
    operator: false,
    parentRegistered: true,
    persistenceReady: true,
    committedHash: "ab",
    preflightHash: "ab",
    buildId: "build",
    approvedBuildId: "build",
    mintAvailable: true,
  }).reason, "public");
  const build = readFileSync(new URL("../../app/api/launch/build/route.ts", import.meta.url), "utf8");
  const prepare = readFileSync(new URL("../../app/api/launch/prepare/route.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../../app/api/admin/trest/build/route.ts", import.meta.url), "utf8");
  assert.match(build, /x-sdk-rehearsal/);
  assert.match(build, /403/);
  assert.match(build, /publicChildLaunchesOpen/);
  assert.match(prepare, /x-sdk-rehearsal/);
  assert.equal(prepare.includes("bindRehearsalParent"), false);
  assert.match(admin, /isProvisionedOperator/);
  assert.match(admin, /publicChildLaunchesOpen/);
  assert.equal(audiencePair(true).label, "$TREST");
  assert.equal(audiencePair(false).label, "$SDK");
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  assert.match(form, /Public launches stay paired with \$SDK/);
  assert.match(form, /audiencePair\(rehearsal\)\.label/);
});

test("a rehearsal build cannot carry a client quote mint", () => {
  const parsed = parseRehearsalBuildRequest({
    launchId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    mintPublicKey: CHILD,
    scope: "test",
    quoteMint: TREST_MINT,
  });
  assert.equal(parsed.ok, false);
  const substituted = publicLaunchScope({
    launchId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    mintPublicKey: CHILD,
    quoteMint: SDK,
  });
  assert.equal(substituted.ok, false);
  const production = selectLaunchParent({
    audience: "public",
    requestedScope: null,
    requestedMint: null,
    productionMint: null,
    testParent: { mint: TREST_MINT, scope: "test", eligible: true },
  });
  assert.equal(production.ok && production.scope, "production");
  assert.equal(production.ok && production.executes, false);
  assert.equal(TOKEN_2022_PROGRAM.startsWith("Tokenz"), true);
});

test("fee splits stay on the three locked schedules", () => {
  const official = allocateCreatorFees({
    category: "official",
    launcherWallet: LAUNCHER,
    originatorWallet: null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  const own = allocateCreatorFees({
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
  assert.equal(official.ok && own.ok && community.ok, true);
  if (!official.ok || !own.ok || !community.ok) return;
  assert.deepEqual(official.shareholders.map((row) => row.shareBps).sort((a, b) => a - b), [4000, 6000]);
  assert.deepEqual(own.shareholders.map((row) => row.shareBps).sort((a, b) => a - b), [1500, 8500]);
  assert.deepEqual(community.shareholders.map((row) => row.shareBps).sort((a, b) => a - b), [1500, 2500, 6000]);
});

test("version-1 launches keep the packet, account, signer, and priority-fee limits", () => {
  assert.equal(V1_PACKET_LIMIT_BYTES, 4096);
  assert.equal(V1_ACCOUNT_LIMIT, 64);
  assert.equal(V1_COMPUTE_UNIT_LIMIT, 1_400_000);
  assert.equal(V1_PRIORITY_FEE_LAMPORTS, LAUNCH_PRIORITY_FEE_LAMPORTS);
  assert.match(networkCostCopy(), /0\.000005 SOL/);
  const compiler = readFileSync(new URL("../../services/transaction-builder/src/v1.ts", import.meta.url), "utf8");
  assert.match(compiler, /signers\.length === 2/);
  const assembler = readFileSync(new URL("../../services/transaction-builder/src/assemble.ts", import.meta.url), "utf8");
  assert.match(assembler, /quoteMint: input\.parentMint/);
  assert.match(assembler, /NATIVE_MINT/);
});

test("verification stores a chain slot and does not treat submission as success", () => {
  const accepted = noteBroadcast(
    {
      launchId: "launch",
      buildId: "build",
      childMint: CHILD,
      parentMint: TREST_MINT,
      scope: "test",
      wallet: LAUNCHER,
      signature: "2".repeat(88),
      messageHash: "ab".repeat(32),
      status: "submission_pending",
      wireRetained: true,
    },
    "accepted",
  );
  assert.equal(accepted.status, "submitted");
  const submitted = verificationStamp({
    status: accepted.status,
    evidenceSlot: null,
    nowMs: 1,
    storedSlot: null,
    storedVerifiedAtMs: null,
  });
  assert.equal(submitted.attemptStatus, null);
  assert.equal(submitted.slot, null);
  const missing = verificationStamp({
    status: "verified",
    evidenceSlot: null,
    nowMs: 1,
    storedSlot: null,
    storedVerifiedAtMs: null,
  });
  assert.equal(missing.status, "verifying");
  const stamped = verificationStamp({
    status: "verified",
    evidenceSlot: "44",
    nowMs: 50,
    storedSlot: null,
    storedVerifiedAtMs: null,
  });
  assert.equal(stamped.status, "verified");
  assert.equal(stamped.slot, "44");
  assert.equal(stamped.verifiedAtMs, 50);
  assert.equal(stamped.attemptStatus, "verified");
  const again = verificationStamp({
    status: "verified",
    evidenceSlot: "90",
    nowMs: 80,
    storedSlot: "44",
    storedVerifiedAtMs: 50,
  });
  assert.equal(again.slot, "44");
  assert.equal(again.verifiedAtMs, 50);
});

test("only a confirmed parent-matched child is discoverable, once", () => {
  const visible = presentVerifiedLaunch(source());
  assert.equal(visible?.pairLabel, "$TREST");
  assert.equal(visible?.parentMint, TREST_MINT);
  assert.equal(presentVerifiedLaunch(source({ status: "submitted", slot: null, verifiedAt: null })), null);
  assert.equal(presentVerifiedLaunch(source({ status: "failed" })), null);
  assert.equal(presentVerifiedLaunch(source({ status: "uncertain", slot: null, verifiedAt: null })), null);
  assert.equal(presentVerifiedLaunch(source({ scope: "test", parentSymbol: "SDK" })), null);
  assert.equal(presentVerifiedLaunch(source({ scope: "production", parentSymbol: "SDK", parentMint: SDK }))?.pairLabel, "$SDK");
  assert.ok(visible);
  const listed = uniqueLaunches([visible, { ...visible }]);
  assert.equal(listed.length, 1);
  assert.equal(launchesForCreator(listed, LAUNCHER).length, 1);
  assert.equal(launchesForCreator(listed, ORIGINATOR).length, 0);
  assert.equal(launchByMint(listed, CHILD)?.sdkName, "Lesson SDK");
  assert.equal(launchByMint(listed, SDK), null);
  const feed = listed;
  const account = launchesForCreator(feed, LAUNCHER);
  const detail = launchByMint(feed, CHILD);
  assert.equal(account[0]?.childMint, detail?.childMint);
  assert.equal(detail?.sdkHref, "/library/22222222-2222-4222-8222-222222222222");
});

test("discovery does not enable the rewards worker", () => {
  const registry = readFileSync(new URL("./registry.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../../services/rewards-worker/src/loop.ts", import.meta.url), "utf8");
  assert.equal(registry.includes("REWARDS_EXECUTION_AUTHORIZED"), false);
  assert.equal(registry.includes("REWARDS_LOOP_ENABLED"), false);
  assert.match(worker, /attempt_status = 'verified'/);
});
