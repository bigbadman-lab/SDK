import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { markExpired, markSubmissionPending, startAttempt, bindMint, markSigned, canReplaceMint } from "./attempt.ts";
import { broadcastSignedTransaction } from "./broadcast.ts";
import { verifyLaunchEvidence, type LaunchCommitment, type LaunchEvidence } from "./chain-evidence.ts";
import { rehearsalGate } from "./rehearsal.ts";
import { beginSubmission, markPageReady, noteBroadcast, noteChain, noteVerification, type SubmissionDraft } from "./submission.ts";
import { openWire, sealWire } from "./wire.ts";

const WALLET = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const CHILD = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const PARENT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const TREST = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";
const PLATFORM = "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC";
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function draft(patch: Partial<SubmissionDraft> = {}): SubmissionDraft {
  return {
    launchId: "launch-1",
    buildId: "build-1",
    childMint: CHILD,
    parentMint: PARENT,
    scope: "production",
    wallet: WALLET,
    signature: "2".repeat(88),
    messageHash: "ab".repeat(32),
    wireRetained: true,
    ...patch,
  };
}

function commitment(patch: Partial<LaunchCommitment> = {}): LaunchCommitment {
  return {
    childMint: CHILD,
    parentMint: PARENT,
    launcher: WALLET,
    tokenProgram: TOKEN,
    metadataUri: "https://example.test/metadata.json",
    buyAmount: "1",
    shareholders: [
      { address: WALLET, shareBps: 6000 },
      { address: TREST, shareBps: 2500 },
      { address: PLATFORM, shareBps: 1500 },
    ],
    ...patch,
  };
}

function evidence(patch: Partial<LaunchEvidence> = {}): LaunchEvidence {
  return {
    transactionStatus: "confirmed",
    transactionError: false,
    slot: "44",
    mintExists: true,
    tokenProgram: TOKEN,
    quoteMint: PARENT,
    launcher: WALLET,
    metadataUri: "https://example.test/metadata.json",
    shareholders: commitment().shareholders,
    adminRevoked: true,
    buyExecuted: true,
    ...patch,
  };
}

test("a signed attempt can be submitted once and an uncertain result keeps the mint", () => {
  const started = startAttempt({ existing: [], wallet: WALLET, launchId: "launch-1", idempotencyKey: "key-1" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const bound = bindMint(started.attempt, CHILD);
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  const signed = markSigned(bound.attempt, "ab".repeat(32));
  const pending = markSubmissionPending(signed);
  assert.equal(pending?.status, "submission_pending");
  assert.equal(canReplaceMint(pending ?? signed), false);
  const first = beginSubmission(null, draft());
  assert.equal(first.ok && first.broadcast, "send");
  if (!first.ok) return;
  const stored = noteBroadcast(first.intent, "timeout");
  assert.equal(stored.status, "uncertain");
  assert.equal(stored.childMint, CHILD);
  const retry = beginSubmission(stored, draft());
  assert.equal(retry.ok && retry.broadcast, "hold");
  assert.equal(retry.ok && retry.intent.signature, stored.signature);
  const changed = beginSubmission(stored, draft({ signature: "3".repeat(88) }));
  assert.equal(changed.ok, false);
  assert.equal(markExpired({ ...signed, status: "uncertain" }).status, "uncertain");
  const expired = noteChain(stored, "missing", true);
  assert.equal(expired.status, "failed");
  assert.equal(expired.childMint, stored.childMint);
  assert.equal(expired.signature, stored.signature);
  assert.equal(noteChain(stored, "missing", false).status, "uncertain");
  assert.equal(noteChain(stored, "confirmed", true).status, "verifying");
});

test("duplicate and concurrent submits do not create a second broadcast", () => {
  const refused = beginSubmission(null, draft({ wireRetained: false }));
  assert.equal(refused.ok, false);
  const first = beginSubmission(null, draft());
  assert.equal(first.ok && first.broadcast, "send");
  if (!first.ok) return;
  const second = beginSubmission({ ...first.intent, wireRetained: false }, draft({ wireRetained: false }));
  assert.equal(second.ok && second.broadcast, "hold");
  const retained = beginSubmission(first.intent, draft());
  assert.equal(retained.ok && retained.broadcast, "send");
  const otherMint = beginSubmission(first.intent, draft({ childMint: TREST }));
  assert.equal(otherMint.ok, false);
});

test("broadcast stays inactive unless the caller explicitly authorises the mock", async () => {
  let calls = 0;
  const inactive = await broadcastSignedTransaction({
    wire: new Uint8Array([1]),
    authorised: false,
    rpc: async () => {
      calls += 1;
      return "accepted";
    },
  });
  assert.equal(inactive.ok, false);
  assert.equal(calls, 0);
  const accepted = await broadcastSignedTransaction({
    wire: new Uint8Array([1]),
    authorised: true,
    rpc: async () => {
      calls += 1;
      return "accepted";
    },
  });
  assert.equal(accepted.ok && accepted.outcome, "accepted");
  const unknown = await broadcastSignedTransaction({
    wire: new Uint8Array([1]),
    authorised: true,
    rpc: async () => {
      throw new Error("timeout");
    },
  });
  assert.equal(unknown.ok && unknown.outcome, "unknown");
  const route = readFileSync(new URL("../../app/api/launch/submit/route.ts", import.meta.url), "utf8");
  assert.equal(route.includes("submitSignedLaunch"), true);
  assert.equal(route.includes("LAUNCH_SUBMISSION_AUTHORIZED"), false);
  assert.equal(route.includes("TREST_DEPLOYER_PRIVATE_KEY"), false);
  assert.equal(route.includes("SDK_DEPLOYER_PRIVATE_KEY"), false);
  const refused = beginSubmission(null, draft({ wireRetained: false }));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "wire_key");
});

test("verification requires chain evidence and does not treat a signature as success", () => {
  const confirmed = verifyLaunchEvidence(commitment(), evidence());
  assert.equal(confirmed.verified, true);
  assert.equal(noteVerification({ ...draft(), status: "verifying" }, confirmed).status, "verified");
  assert.equal(verifyLaunchEvidence(commitment(), evidence({ transactionStatus: "failed", transactionError: true })).failed, true);
  assert.equal(verifyLaunchEvidence(commitment(), evidence({ quoteMint: TREST })).failed, true);
  assert.equal(verifyLaunchEvidence(commitment(), evidence({ shareholders: [{ address: WALLET, shareBps: 10000 }] })).failed, true);
  assert.equal(verifyLaunchEvidence(commitment(), evidence({ adminRevoked: false })).failed, true);
  assert.equal(verifyLaunchEvidence(commitment(), evidence({ buyExecuted: false })).failed, true);
  assert.equal(verifyLaunchEvidence(commitment({ buyAmount: "0" }), evidence({ buyExecuted: false })).verified, true);
  assert.equal(verifyLaunchEvidence(commitment(), evidence({ metadataUri: "https://example.test/other.json" })).failed, true);
  const partial = verifyLaunchEvidence(commitment(), evidence({ shareholders: null, adminRevoked: null }));
  assert.equal(partial.verified, false);
  assert.equal(partial.failed, false);
  assert.equal(noteVerification({ ...draft(), status: "verifying" }, partial).status, "verifying");
  const ready = markPageReady(noteVerification({ ...draft(), status: "verifying" }, confirmed));
  assert.equal(ready?.status, "page_ready");
  assert.equal(markPageReady({ ...draft(), status: "verifying" }), null);
});

test("signed bytes are retained only with an encryption key and can be opened again", () => {
  const wire = new Uint8Array([9, 8, 7]);
  const absent = sealWire(wire, null);
  assert.equal(absent.ok && absent.retained, false);
  const key = new Uint8Array(32).fill(7);
  const sealed = sealWire(wire, key);
  assert.equal(sealed.ok && sealed.retained, true);
  if (!sealed.ok || !sealed.retained) return;
  const opened = openWire(sealed.ciphertext, key);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.deepEqual(opened.wire, wire);
  assert.equal(openWire(sealed.ciphertext, null).ok, false);
});

test("a TREST rehearsal can be selected only as a blocked execution", () => {
  const closed = rehearsalGate({
    registered: false,
    observationOk: false,
    builderReady: false,
    migrationsApplied: false,
    simulationPassed: false,
    operatorAuthorised: false,
  });
  assert.equal(closed.executes, false);
  assert.equal(closed.missing.includes("TREST mint registered"), true);
  const open = rehearsalGate({
    registered: true,
    observationOk: true,
    builderReady: true,
    migrationsApplied: true,
    simulationPassed: true,
    operatorAuthorised: true,
  });
  assert.equal(open.executes, true);
  const form = readFileSync(new URL("../../components/launch/form.tsx", import.meta.url), "utf8");
  assert.match(form, /\$SDK/);
  assert.equal(form.includes("sendTransaction"), false);
  const admin = readFileSync(new URL("../../components/admin/trest-form.tsx", import.meta.url), "utf8");
  assert.equal(admin.includes("RehearsalNotice"), true);
  assert.equal(admin.includes("sendTransaction"), false);
});
