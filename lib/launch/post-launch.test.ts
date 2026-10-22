import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyLaunchEvidence } from "./chain-evidence.ts";
import { audiencePair, verificationStamp } from "./verified-launch.ts";
import {
  CONFIRMATION_LIMIT_MS,
  blocksNewLaunch,
  confirmationObservation,
  confirmationStatus,
  failureExplanation,
  launchWatchCopy,
  nextPollDelay,
  recoveryBroadcast,
  toOpenLaunch,
  watchLaunch,
} from "./post-launch.ts";
import { beginSubmission, noteChain, type SubmissionDraft, type SubmissionIntent } from "./submission.ts";
import { planRecovery } from "./submit-plan.ts";

const CHILD = "7Rrmq49nP4pFckExFxybJuqFwQbiKeGedbD22w5twvQB";
const PARENT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const WALLET = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";
const OTHER = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";

function draft(patch: Partial<SubmissionDraft> = {}): SubmissionDraft {
  return {
    launchId: "9104b3e4-46c9-4f0d-8b91-cb69a1f34a87",
    buildId: "49b9ad68-2305-444b-8998-5dcd254068c3",
    childMint: CHILD,
    parentMint: PARENT,
    scope: "test",
    wallet: WALLET,
    signature: "2".repeat(88),
    messageHash: "ab".repeat(32),
    wireRetained: true,
    ...patch,
  };
}

function intent(status: SubmissionIntent["status"]): SubmissionIntent {
  return { ...draft(), status };
}

test("a wallet rejection is not a submitted or failed launch", () => {
  const watch = watchLaunch({ phase: "wallet_rejected", elapsedMs: 0, signature: null });
  assert.equal(watch.watch, "rejected");
  assert.equal(watch.polling, false);
  assert.equal(launchWatchCopy(watch.watch).body.includes("Nothing was submitted."), true);
  assert.equal(launchWatchCopy(watch.watch).title.includes("could not be completed"), false);
});

test("an accepted submission keeps polling while confirmation is pending", () => {
  const pending = watchLaunch({ phase: "awaiting_confirmation", elapsedMs: 1_000, signature: "2".repeat(88) });
  assert.equal(pending.watch, "launching");
  assert.equal(pending.polling, true);
  assert.equal(launchWatchCopy("launching").title, "Your SDK token is launching");
  assert.equal(nextPollDelay(0), 2_000);
  assert.equal(confirmationStatus({ status: "submitted", observed: "missing", blockhashExpired: false }), "submitted");
  assert.equal(confirmationStatus({ status: "submitted", observed: "uncertain", blockhashExpired: false }), "submitted");
});

test("a later confirmation verifies once and does not broadcast again", () => {
  const submitted = intent("submitted");
  const missing = planRecovery({
    existing: submitted,
    observed: "missing",
    blockhashExpired: false,
    approvalMatches: true,
    wireRetained: true,
  });
  assert.equal(missing.ok && missing.action, "hold");
  assert.equal(missing.ok && missing.intent.status, "submitted");
  assert.equal(missing.ok && missing.intent.signature, submitted.signature);
  const confirmed = planRecovery({
    existing: submitted,
    observed: "confirmed",
    blockhashExpired: false,
    approvalMatches: true,
    wireRetained: true,
  });
  assert.equal(confirmed.ok && confirmed.action, "hold");
  assert.equal(confirmed.ok && confirmed.intent.status, "verifying");
  const verified = planRecovery({
    existing: { ...submitted, status: "verified" },
    observed: "confirmed",
    blockhashExpired: false,
    approvalMatches: true,
    wireRetained: true,
  });
  assert.equal(verified.ok && verified.action, "hold");
  assert.equal(verified.ok && verified.intent.status, "verified");
  assert.equal(recoveryBroadcast("submitted", "submitted"), "hold");
  for (const prior of ["submission_pending", "submitted", "pending_confirmation", "verifying", "uncertain", "failed", "verified"]) {
    for (const next of ["submission_pending", "submitted", "uncertain", "verifying", "failed", "verified"]) {
      assert.equal(recoveryBroadcast(prior, next), "hold");
    }
  }
  assert.equal(blocksNewLaunch("page_ready"), false);
  const expired = planRecovery({
    existing: submitted,
    observed: "missing",
    blockhashExpired: true,
    approvalMatches: true,
    wireRetained: true,
  });
  assert.equal(expired.ok && expired.action, "hold");
  assert.equal(expired.ok && expired.intent.status, "failed");
  assert.equal(expired.ok && expired.intent.signature, submitted.signature);
  const unresolved = confirmationObservation({ chain: "missing", signature: "unknown" });
  assert.equal(unresolved.blockhashExpired, false);
  assert.equal(confirmationStatus({ status: "uncertain", observed: "missing", blockhashExpired: false }), "uncertain");
  const dead = confirmationObservation({ chain: null, signature: "absent" });
  assert.equal(dead.blockhashExpired, true);
  assert.equal(dead.observed, "missing");
  const closed = planRecovery({
    existing: intent("uncertain"),
    observed: dead.observed,
    blockhashExpired: dead.blockhashExpired,
    approvalMatches: true,
    wireRetained: true,
  });
  assert.equal(closed.ok && closed.action, "hold");
  assert.equal(closed.ok && closed.intent.status, "failed");
  assert.equal(closed.ok && blocksNewLaunch(closed.intent.status), false);
  const seen = confirmationObservation({ chain: "missing", signature: "confirmed" });
  assert.equal(seen.observed, "confirmed");
  assert.equal(seen.blockhashExpired, false);
  const again = beginSubmission(submitted, draft());
  assert.equal(again.ok && again.broadcast, "hold");
  assert.equal(again.ok && again.intent.signature, submitted.signature);
  const stamp = verificationStamp({
    status: "verified",
    evidenceSlot: "460107051",
    nowMs: 1_700_000_000_000,
    storedSlot: null,
    storedVerifiedAtMs: null,
  });
  assert.equal(stamp.slot, "460107051");
  assert.equal(stamp.verifiedAtMs, 1_700_000_000_000);
  assert.equal(stamp.attemptStatus, "verified");
  const live = watchLaunch({ phase: "verified", elapsedMs: 4_000, signature: submitted.signature });
  assert.equal(live.watch, "live");
  assert.equal(live.polling, false);
  assert.equal(launchWatchCopy("live").title, "Your SDK token is live!");
});

test("a delayed lookup is not a failure and a chain failure is final", () => {
  const delayed = watchLaunch({
    phase: "awaiting_confirmation",
    elapsedMs: CONFIRMATION_LIMIT_MS,
    signature: "2".repeat(88),
  });
  assert.equal(delayed.watch, "delayed");
  assert.equal(delayed.polling, false);
  assert.equal(nextPollDelay(CONFIRMATION_LIMIT_MS), null);
  assert.equal(launchWatchCopy("delayed").title, "Your launch is still being confirmed");
  assert.equal(launchWatchCopy("delayed").body.includes("may still succeed"), true);
  const failed = noteChain(intent("submitted"), "failed", false);
  assert.equal(failed.status, "failed");
  const shown = watchLaunch({ phase: "failed", elapsedMs: 1_000, signature: failed.signature });
  assert.equal(shown.watch, "failed");
  assert.equal(shown.polling, false);
  assert.equal(failureExplanation(failed.signature, null).includes("new mint was not created"), true);
  assert.equal(failureExplanation(failed.signature, null).toLowerCase().includes("sign another"), false);
});

test("the wrong mint, wallet, or parent cannot verify, and an open launch blocks another mint", () => {
  const commitment = {
    childMint: CHILD,
    parentMint: PARENT,
    launcher: WALLET,
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    metadataUri: "https://example.test/metadata.json",
    buyAmount: "0",
    shareholders: [{ address: WALLET, shareBps: 6000 }, { address: "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC", shareBps: 4000 }],
  };
  const evidence = {
    transactionStatus: "confirmed" as const,
    transactionError: false,
    slot: "460107051",
    mintExists: true,
    tokenProgram: commitment.tokenProgram,
    quoteMint: PARENT,
    launcher: WALLET,
    metadataUri: commitment.metadataUri,
    shareholders: commitment.shareholders,
    adminRevoked: true,
    buyExecuted: false,
  };
  assert.equal(verifyLaunchEvidence(commitment, evidence).verified, true);
  assert.equal(verifyLaunchEvidence(commitment, { ...evidence, quoteMint: OTHER }).verified, false);
  assert.equal(verifyLaunchEvidence(commitment, { ...evidence, launcher: OTHER }).verified, false);
  const started = beginSubmission(null, draft());
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(beginSubmission(started.intent, draft({ childMint: OTHER })).ok, false);
  assert.equal(blocksNewLaunch("submitted"), true);
  assert.equal(blocksNewLaunch("verifying"), true);
  assert.equal(blocksNewLaunch("uncertain"), true);
  assert.equal(blocksNewLaunch("verified"), false);
  assert.equal(blocksNewLaunch("failed"), false);
  const open = toOpenLaunch({
    launchId: draft().launchId,
    status: "submitted",
    scope: "test",
    childMint: CHILD,
    parentMint: PARENT,
    signature: draft().signature,
    tokenName: "Venture",
    tokenSymbol: "VENT",
    imageUrl: "https://example.test/venture.png",
    parentSymbol: "TREST",
  });
  assert.equal(open?.pairLabel, "$TREST");
  assert.equal(
    toOpenLaunch({
      launchId: draft().launchId,
      status: "verified",
      scope: "test",
      childMint: CHILD,
      parentMint: PARENT,
      signature: draft().signature,
      tokenName: "Venture",
      tokenSymbol: "VENT",
      imageUrl: "https://example.test/venture.png",
      parentSymbol: "TREST",
    }),
    null,
  );
});

test("TREST and production wording stay apart and the public launch stays closed", () => {
  assert.equal(audiencePair(true).label, "$TREST");
  assert.equal(audiencePair(false).label, "$SDK");
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../../components/launch/rehearsal-actions.tsx", import.meta.url), "utf8");
  const progress = readFileSync(new URL("../../components/launch/launch-progress.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/launch/page.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../server/launch/service.ts", import.meta.url), "utf8");
  assert.equal(form.includes('phase="unavailable"'), true);
  assert.equal(form.includes("Public launches stay paired with $SDK."), true);
  assert.equal(actions.includes("audiencePair(true)"), true);
  assert.equal(actions.includes("readRecovery"), true);
  assert.equal(actions.includes("nextPollDelay"), true);
  assert.equal(actions.includes('setPhase("unavailable")'), false);
  assert.equal(progress.includes("Check Launch Status"), true);
  assert.equal(progress.includes("View Token"), true);
  assert.equal(progress.includes("View on Paired"), true);
  assert.equal(progress.includes("/feed"), false);
  assert.equal(progress.includes("/api/launch/submit"), false);
  assert.equal(page.includes("isProvisionedOperator"), true);
  assert.equal(service.includes("launch_open"), true);
  assert.equal(readFileSync(new URL("./post-launch.ts", import.meta.url), "utf8").includes("rewards"), false);
});
