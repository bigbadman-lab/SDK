import { accountingWindow } from "../../../lib/rewards/ledger.ts";
import { buildSolClaim, buildTokenClaim } from "../../../lib/rewards/claim.ts";
import { windowKey } from "../../../lib/rewards/cycle.ts";
import { messageSha256, signedTransactionWire, type CompiledTransaction } from "../../../lib/rewards/inspect.ts";
import { snapshotHolders } from "../../../lib/rewards/holders.ts";
import { boundClaimMessage, claimAuthorizationMessage, parseBoundClaim, verifyClaimOwnership } from "../../../lib/rewards/ownership.ts";
import { explainCreatorDelta, reconcileCreatorFee } from "../../../lib/rewards/reconcile.ts";
import { TREST_MINT } from "../../../lib/launch/verified-launch.ts";
import { registrationFromParent, resolveProductionParent, type CanonicalParentConfig } from "../../../lib/rewards/production.ts";
import { derivedDeployerAddress, rewardsExecutionEnabled } from "../../../lib/rewards/signer.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { shutdownRequested } from "./lifecycle.ts";
import { bondingCurveAddress, pollTransactionConfirmation, readCreatorVaults, type Chain, type ObservedTransaction, type SignatureObservation, type VaultLookup } from "./chain.ts";
import { legacyCollectionRetired } from "./legacy-recovery.ts";
import { buildSolCollection, type BuiltInstruction } from "./instructions.ts";
import type { RegisteredParent, RewardControl, RewardsStore, StoredIntent } from "./store.ts";

const RENT_CAP = "50000000";

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validityNote(height: string | null, detail: string): string {
  return `last_valid_block_height=${height ?? "unknown"}; ${detail}`.slice(0, 240);
}

function storedValidityHeight(detail: string | null): string | null {
  const match = detail?.match(/last_valid_block_height=([0-9]+)/);
  return match?.[1] ?? null;
}

async function readOrUnknown<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

function confirmationWait(chain: Chain): (ms: number) => Promise<void> {
  return chain.pace ?? pause;
}

async function observeSignature(chain: Chain, signature: string, lookup: VaultLookup) {
  const readStatus = chain.signatureStatus?.bind(chain);
  return pollTransactionConfirmation({
    read: () => chain.transaction(signature, lookup),
    status: () => readStatus?.(signature) ?? Promise.resolve("unknown" satisfies SignatureObservation),
    wait: confirmationWait(chain),
  });
}

type CycleCode =
  | "control"
  | "destination"
  | "failed"
  | "identity"
  | "inactive"
  | "locked"
  | "market"
  | "parent"
  | "program"
  | "rehearsal"
  | "schedule"
  | "closed"
  | "stopped"
  | "signer_malformed"
  | "signer_mismatch"
  | "signer_unbound"
  | "spend"
  | "suspended"
  | "transaction"
  | "uncertain"
  | "unfunded"
  | "unreconciled"
  | "vault"
  | "wsol";

export type CycleResult =
  | {
      ok: true;
      stage: "idle" | "collected" | "recovered";
      netLamports: string;
      tokenCredited: string;
      holderPolicy?: "no_eligible_holders";
    }
  | { ok: false; code: CycleCode };

function bare(instructions: BuiltInstruction[]): CompiledTransaction["instructions"] {
  return instructions.map((instruction) => ({ programId: instruction.programId, keys: instruction.keys, data: instruction.data }));
}

async function settleCollection(input: {
  parent: RegisteredParent;
  observed: ObservedTransaction;
  signature: string;
  store: RewardsStore;
}): Promise<{ ok: true; net: string } | { ok: false; code: CycleCode }> {
  if (input.observed.status === "uncertain") return { ok: false, code: "uncertain" };
  if (input.observed.status === "failed") return { ok: false, code: "failed" };
  const explained = explainCreatorDelta({
    creatorDeltaLamports: input.observed.creatorDelta,
    nativeVaultOutLamports: input.observed.nativeVaultOut,
    wsolClosedLamports: input.observed.wsolClosedLamports,
    networkFeeLamports: input.observed.feeLamports,
    deployerPaidFee: input.observed.feePayer === input.parent.deployerAddress,
  });
  if (!explained.ok) return { ok: false, code: "unreconciled" };
  const credited = reconcileCreatorFee({
    status: "confirmed",
    signature: input.signature,
    slot: input.observed.slot,
    parentMint: input.parent.mintAddress,
    scope: input.parent.scope,
    creator: input.parent.deployerAddress,
    feePayer: input.observed.feePayer,
    vaultOutLamports: input.observed.nativeVaultOut,
    creatorDeltaLamports: input.observed.creatorDelta,
    networkFeeLamports: input.observed.feeLamports,
    unrelatedDepositLamports: explained.unrelatedDepositLamports,
    wsolTokenOut: input.observed.wsolTokenOut,
    wsolClosedLamports: input.observed.wsolClosedLamports,
    wsolRentLamports: input.observed.wsolRentLamports,
    existing: await input.store.receipts(input.parent.mintAddress, input.parent.scope),
  });
  if (!credited.ok) {
    if (credited.code === "duplicate") return { ok: true, net: "0" };
    if (credited.code === "wsol" || credited.code === "unreconciled" || credited.code === "fee_source") {
      return { ok: false, code: credited.code === "wsol" ? "wsol" : "unreconciled" };
    }
    return { ok: false, code: "uncertain" };
  }
  const saved = await input.store.saveReceipt({ ...credited.receipt, gross: credited.gross, fee: credited.fee, native: credited.native, wsolConverted: credited.wsolConverted, rentExcluded: credited.rentExcluded });
  if (saved === "duplicate") return { ok: true, net: credited.net };
  return { ok: true, net: credited.net };
}

async function broadcast(input: {
  secret: string;
  expectedAddress: string;
  suspended: boolean;
  parent: RegisteredParent;
  control: RewardControl;
  intent: { key: string; kind: StoredIntent["kind"]; amount: string };
  transaction: CompiledTransaction;
  chain: Chain;
  store: RewardsStore;
  lookup: VaultLookup;
  validityHeight: string | null;
}): Promise<{ ok: true; observed: ObservedTransaction; signature: string } | { ok: false; code: CycleCode }> {
  if (shutdownRequested()) return { ok: false, code: "inactive" };
  const recorded = await input.store.recordIntent({
    idempotencyKey: input.intent.key,
    parentMint: input.parent.mintAddress,
    scope: input.parent.scope,
    kind: input.intent.kind,
    amountLamports: input.intent.amount,
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: input.transaction.recentBlockhash,
  });
  if (recorded === "duplicate") return { ok: false, code: "uncertain" };
  const signed = signInspected({
    secret: input.secret,
    expectedAddress: input.expectedAddress,
    suspended: input.suspended || input.control.suspended,
    transaction: input.transaction,
    policy: {
      kind: input.intent.kind,
      scope: input.parent.scope,
      parentMint: input.parent.mintAddress,
      deployer: input.parent.deployerAddress,
      recipient: input.intent.kind === "collect" || input.intent.kind === "buyback" ? input.parent.deployerAddress : input.transaction.instructions[0]?.keys[1]?.pubkey ?? "",
      maxLamports: input.intent.kind === "collect" ? "0" : input.intent.amount,
      maxRentLamports: input.intent.kind === "claim_sol" ? "0" : RENT_CAP,
      tokenProgram: input.parent.tokenProgram,
    },
  });
  if (!signed.ok) return { ok: false, code: signed.code };
  const marked = await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "submitted", signed.signature);
  if (marked !== "ok") return { ok: false, code: "uncertain" };
  const noted = await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, input.intent.key, {
    recentBlockhash: input.transaction.recentBlockhash,
    submissionCode: "confirmation_pending",
    submissionDetail: validityNote(input.validityHeight, "signature stored before submission"),
  });
  if (noted !== "ok") return { ok: false, code: "uncertain" };
  const wire = signedTransactionWire(input.transaction, signed.signature);
  if (!wire || messageSha256(signed.message).length !== 64) return { ok: false, code: "transaction" };
  if (shutdownRequested()) {
    await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "failed", signed.signature);
    return { ok: false, code: "inactive" };
  }
  const sent = await input.chain.submit(wire);
  if (sent.status !== "accepted") {
    const definitive = sent.status === "preflight" || sent.status === "rejected" || sent.status === "expired";
    const status = definitive ? "failed" : "uncertain";
    const markedFailure = await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, status, signed.signature);
    await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, input.intent.key, {
      recentBlockhash: null,
      submissionCode: sent.code,
      submissionDetail: validityNote(input.validityHeight, sent.detail),
    });
    if (markedFailure !== "ok") return { ok: false, code: "uncertain" };
    return { ok: false, code: definitive ? "failed" : "uncertain" };
  }
  const polled = await observeSignature(input.chain, signed.signature, input.lookup);
  if (polled.kind === "pending") {
    await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "uncertain", signed.signature);
    await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, input.intent.key, {
      recentBlockhash: null,
      submissionCode: "confirmation_pending",
      submissionDetail: validityNote(input.validityHeight, "confirmation not visible before the bounded wait"),
    });
    return { ok: false, code: "uncertain" };
  }
  if (polled.kind === "failed" || polled.observed.status === "failed") {
    await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "failed", signed.signature);
    await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, input.intent.key, {
      recentBlockhash: null,
      submissionCode: "onchain_failed",
      submissionDetail: validityNote(input.validityHeight, "confirmed on-chain failure"),
    });
    if (polled.kind === "failed") return { ok: false, code: "failed" };
    return { ok: true, observed: polled.observed, signature: signed.signature };
  }
  if (polled.observed.status === "uncertain") return { ok: false, code: "uncertain" };
  await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, input.intent.key, {
    recentBlockhash: null,
    submissionCode: "confirmed",
    submissionDetail: validityNote(input.validityHeight, "confirmed"),
  });
  return { ok: true, observed: polled.observed, signature: signed.signature };
}

async function skipMissedRehearsalWindows(input: {
  nowMs: number;
  parentMint: string;
  scope: "test";
  store: RewardsStore;
}): Promise<{ ok: true } | { ok: false; code: CycleCode }> {
  const rehearsal = await input.store.rehearsalState(input.parentMint, input.scope);
  if (!rehearsal || rehearsal.status !== "open") return { ok: true };
  const current = accountingWindow(input.nowMs);
  if (!current) return { ok: false, code: "schedule" };
  const known = new Map(rehearsal.processed.map((row) => [row.windowStartMs, row.outcome]));
  const intents = await input.store.intents(input.parentMint, input.scope);
  for (const start of rehearsal.windowStartsMs) {
    if (start >= current.startMs) break;
    const outcome = known.get(start);
    if (outcome === "ok" || outcome === "skipped") continue;
    if (outcome === "stopped") return { ok: false, code: "stopped" };
    const collect = intents.find((intent) => intent.idempotencyKey === `collect-${start}`);
    const unsafe = collect !== undefined && (
      collect.status === "submitted"
      || collect.status === "uncertain"
      || collect.status === "unreconciled"
      || collect.status === "failed"
    );
    if (unsafe || outcome === "claimed") {
      if (!outcome) {
        const admission = await input.store.claimRehearsalWindow({
          parentMint: input.parentMint,
          scope: input.scope,
          windowStartMs: start,
        });
        if (!admission.ok && admission.code !== "claimed") {
          return { ok: false, code: admission.code === "absent" ? "rehearsal" : admission.code };
        }
      }
      await input.store.finishRehearsalWindow({
        parentMint: input.parentMint,
        scope: input.scope,
        windowStartMs: start,
        outcome: "stopped",
      });
      return { ok: false, code: unsafe ? "uncertain" : "stopped" };
    }
    const admission = await input.store.claimRehearsalWindow({
      parentMint: input.parentMint,
      scope: input.scope,
      windowStartMs: start,
    });
    if (!admission.ok) {
      if (admission.code === "claimed") return { ok: false, code: "unreconciled" };
      return { ok: false, code: admission.code === "absent" ? "rehearsal" : admission.code };
    }
    if (admission.admission === "replay") continue;
    const finished = await input.store.finishRehearsalWindow({
      parentMint: input.parentMint,
      scope: input.scope,
      windowStartMs: start,
      outcome: "skipped",
    });
    if (finished !== "ok") return { ok: false, code: "unreconciled" };
  }
  return { ok: true };
}

export async function runCycle(input: {
  nowMs: number;
  holder: string;
  loopEnabled: boolean;
  authorised: boolean;
  suspended: boolean;
  secret: string | null;
  expectedAddress: string;
  store: RewardsStore;
  chain: Chain;
}): Promise<CycleResult> {
  if (!rewardsExecutionEnabled({
    loopEnabled: input.loopEnabled ? "true" : "false",
    executionAuthorised: input.authorised ? "true" : "false",
    suspended: input.suspended,
  })) {
    return { ok: false, code: "inactive" };
  }
  const parent = await input.store.parent("test");
  if (!parent || !parent.eligible || parent.symbol !== "TREST" || parent.feeMode !== "single_recipient" || parent.feeRecipientAddress !== parent.deployerAddress) {
    return { ok: false, code: "parent" };
  }
  const derived = input.secret ? derivedDeployerAddress(input.secret) : null;
  if (!derived || derived !== input.expectedAddress || derived !== parent.deployerAddress) return { ok: false, code: "signer_mismatch" };
  const control = await input.store.control(parent.mintAddress, parent.scope);
  if (!control) return { ok: false, code: "control" };
  if (control.suspended) return { ok: false, code: "suspended" };
  const window = accountingWindow(input.nowMs);
  if (!window) return { ok: false, code: "schedule" };
  const lease = await input.store.tryLock(parent.mintAddress, parent.scope, input.holder, input.nowMs);
  if (lease === "locked") return { ok: false, code: "locked" };
  try {
    const skipped = await skipMissedRehearsalWindows({
      nowMs: input.nowMs,
      parentMint: parent.mintAddress,
      scope: "test",
      store: input.store,
    });
    if (!skipped.ok) return skipped;
    const rehearsed = await input.store.rehearsalState(parent.mintAddress, parent.scope);
    if (rehearsed && rehearsed.status !== "open") return { ok: false, code: rehearsed.status };
    const admission = await input.store.claimRehearsalWindow({
      parentMint: parent.mintAddress,
      scope: parent.scope,
      windowStartMs: window.startMs,
    });
    if (!admission.ok && admission.code === "claimed") {
      const pendingIntents = await input.store.intents(parent.mintAddress, parent.scope);
      const pending = pendingIntents.find((intent) => intent.idempotencyKey === `collect-${window.startMs}` && intent.signature);
      if (!pending) {
        await input.store.finishRehearsalWindow({
          parentMint: parent.mintAddress,
          scope: parent.scope,
          windowStartMs: window.startMs,
          outcome: "stopped",
        });
        return { ok: false, code: "stopped" };
      }
      const resumed = await execute(input, parent, control);
      const resumedIntents = await input.store.intents(parent.mintAddress, parent.scope);
      const resumedOutcome = rehearsalOutcome(resumed, resumedIntents, window.startMs);
      await input.store.finishRehearsalWindow({
        parentMint: parent.mintAddress,
        scope: parent.scope,
        windowStartMs: window.startMs,
        outcome: resumedOutcome,
      });
      if (resumedOutcome === "stopped" && resumed.ok) return { ok: false, code: "failed" };
      return resumed;
    }
    if (!admission.ok) {
      if (admission.code === "claimed") return { ok: false, code: "uncertain" };
      return { ok: false, code: admission.code === "absent" ? "rehearsal" : admission.code };
    }
    try {
      const result = await execute(input, parent, control);
      const intents = await input.store.intents(parent.mintAddress, parent.scope);
      const outcome = rehearsalOutcome(result, intents, window.startMs);
      await input.store.finishRehearsalWindow({
        parentMint: parent.mintAddress,
        scope: parent.scope,
        windowStartMs: window.startMs,
        outcome,
      });
      if (outcome === "stopped" && result.ok) return { ok: false, code: "failed" };
      return result;
    } catch (error) {
      await input.store.finishRehearsalWindow({
        parentMint: parent.mintAddress,
        scope: parent.scope,
        windowStartMs: window.startMs,
        outcome: "stopped",
      });
      throw error;
    }
  } finally {
    await input.store.unlock(parent.mintAddress, parent.scope, input.holder);
  }
}

export async function runProductionCycle(input: {
  nowMs: number;
  holder: string;
  loopEnabled: boolean;
  authorised: boolean;
  suspended: boolean;
  secret: string | null;
  expectedAddress: string;
  shuttingDown: boolean;
  parent: RegisteredParent | null;
  config: CanonicalParentConfig | null;
  store: RewardsStore;
  chain: Chain;
}): Promise<CycleResult> {
  if (input.shuttingDown || shutdownRequested()) return { ok: false, code: "inactive" };
  if (!rewardsExecutionEnabled({
    loopEnabled: input.loopEnabled ? "true" : "false",
    executionAuthorised: input.authorised ? "true" : "false",
    suspended: input.suspended,
  })) {
    return { ok: false, code: "inactive" };
  }
  const resolved = resolveProductionParent({
    registration: input.parent ? registrationFromParent(input.parent) : null,
    config: input.config,
    signerAddress: input.expectedAddress,
  });
  if (!resolved.ok) return { ok: false, code: resolved.code === "signer" ? "signer_mismatch" : "parent" };
  if (!resolved.rewardsActive) return { ok: false, code: "inactive" };
  const parent = input.parent;
  if (!parent || parent.scope !== "production" || parent.mintAddress !== resolved.mint) return { ok: false, code: "parent" };
  const derived = input.secret ? derivedDeployerAddress(input.secret) : null;
  if (!derived || derived !== input.expectedAddress || derived !== resolved.deployer) return { ok: false, code: "signer_mismatch" };
  const control = await input.store.control(parent.mintAddress, parent.scope);
  if (!control) return { ok: false, code: "control" };
  if (control.suspended) return { ok: false, code: "suspended" };
  const window = accountingWindow(input.nowMs);
  if (!window) return { ok: false, code: "schedule" };
  const lease = await input.store.tryLock(parent.mintAddress, parent.scope, input.holder, input.nowMs);
  if (lease === "locked") return { ok: false, code: "locked" };
  try {
    if (input.shuttingDown || shutdownRequested()) return { ok: false, code: "inactive" };
    return await execute(input, parent, control);
  } finally {
    await input.store.unlock(parent.mintAddress, parent.scope, input.holder);
  }
}

function rehearsalOutcome(result: CycleResult, intents: StoredIntent[], windowStartMs: number): "ok" | "stopped" {
  if (!result.ok) return "stopped";
  const keys = new Set([`collect-${windowStartMs}`, `buyback-${windowStartMs}`]);
  const unsafe = intents.some((intent) =>
    keys.has(intent.idempotencyKey)
    && (intent.status === "failed" || intent.status === "uncertain" || intent.status === "unreconciled")
  );
  return unsafe ? "stopped" : "ok";
}

async function reconcileOpenCollections(input: {
  parent: RegisteredParent;
  store: RewardsStore;
  chain: Chain;
  lookup: VaultLookup;
}): Promise<{ ok: true; recovered: boolean } | { ok: false; code: CycleCode }> {
  const intents = await input.store.intents(input.parent.mintAddress, input.parent.scope);
  const retired = await input.store.legacyRecoveries(input.parent.mintAddress, input.parent.scope);
  const open = intents.filter((intent) =>
    intent.kind === "collect"
    && (intent.status === "submitted" || intent.status === "uncertain" || intent.status === "unreconciled")
    && !legacyCollectionRetired(intent, retired)
  );
  let recovered = false;
  for (const intent of open) {
    if (!intent.signature) return { ok: false, code: "uncertain" };
    const polled = await observeSignature(input.chain, intent.signature, input.lookup);
    const observed = polled.kind === "observed" ? polled.observed : null;
    if (polled.kind === "failed") {
      const marked = await input.store.markIntent(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, "failed", intent.signature);
      if (marked !== "ok") return { ok: false, code: "uncertain" };
      await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, {
        recentBlockhash: null,
        submissionCode: "onchain_failed",
        submissionDetail: "confirmed on-chain failure",
      });
      continue;
    }
    if (observed?.status === "confirmed") {
      const settled = await settleCollection({ parent: input.parent, observed, signature: intent.signature, store: input.store });
      if (!settled.ok) {
        await input.store.markIntent(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, "unreconciled", intent.signature);
        return settled;
      }
      const marked = await input.store.markIntent(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, "confirmed", intent.signature);
      if (marked !== "ok") return { ok: false, code: "uncertain" };
      recovered = true;
      continue;
    }
    if (observed?.status === "failed") {
      const marked = await input.store.markIntent(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, "failed", intent.signature);
      if (marked !== "ok") return { ok: false, code: "uncertain" };
      await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, {
        recentBlockhash: null,
        submissionCode: "onchain_failed",
        submissionDetail: "confirmed on-chain failure",
      });
      continue;
    }
    const signature = intent.signature;
    let absent: "present" | "absent" | "unknown" = observed ? "present" : "unknown";
    if (!observed && signature) {
      absent = await readOrUnknown(() => input.chain.signatureState(signature), "unknown");
    }
    const blockhash = intent.recentBlockhash;
    const blockhashState = !observed && absent === "absent" && blockhash
      ? await readOrUnknown(() => input.chain.blockhashValid(blockhash), "unknown")
      : "unknown";
    const readHeight = input.chain.blockHeight;
    const blockHeight = !observed && absent === "absent" && readHeight
      ? await readOrUnknown(() => readHeight(), null)
      : null;
    const height = storedValidityHeight(intent.submissionDetail);
    const passedHeight = height !== null && blockHeight !== null && /^[0-9]+$/.test(blockHeight) && BigInt(blockHeight) > BigInt(height);
    const expired = blockhashState === "expired" || passedHeight;
    if (!observed && absent === "absent" && expired) {
      const marked = await input.store.markIntent(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, "failed", intent.signature);
      if (marked !== "ok") return { ok: false, code: "uncertain" };
      await input.store.recordSubmission(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, {
        recentBlockhash: null,
        submissionCode: "expired",
        submissionDetail: "signature absent after the stored blockhash expired",
      });
      continue;
    }
    if (intent.status !== "unreconciled") {
      await input.store.markIntent(input.parent.mintAddress, input.parent.scope, intent.idempotencyKey, "uncertain", intent.signature);
    }
    return { ok: false, code: "uncertain" };
  }
  return { ok: true, recovered };
}

async function execute(
  input: { nowMs: number; secret: string | null; expectedAddress: string; suspended: boolean; store: RewardsStore; chain: Chain },
  parent: RegisteredParent,
  control: RewardControl,
): Promise<CycleResult> {
  const secret = input.secret;
  if (!secret) return { ok: false, code: "signer_mismatch" };
  const window = accountingWindow(input.nowMs);
  if (!window) return { ok: false, code: "parent" };
  const collectKey = `collect-${window.startMs}`;
  const mint = await input.chain.mint(parent.mintAddress);
  if (!mint || mint.decimals !== parent.decimals || mint.tokenProgram !== parent.tokenProgram) return { ok: false, code: "parent" };
  const vaults = await readCreatorVaults(input.chain, parent.deployerAddress);
  if (!vaults.ok) return vaults;
  const lookup: VaultLookup = {
    creator: parent.deployerAddress,
    solVault: vaults.solVault,
    wsolVault: vaults.wsolVault,
    parentMint: parent.mintAddress,
    destination: parent.deployerAddress,
  };
  const reconciled = await reconcileOpenCollections({ parent, store: input.store, chain: input.chain, lookup });
  if (!reconciled.ok) return reconciled;
  const intents = await input.store.intents(parent.mintAddress, parent.scope);
  const collectIntent = intents.find((intent) => intent.idempotencyKey === collectKey);
  if (!reconciled.recovered && !collectIntent?.signature && (vaults.nativeLamports !== "0" || vaults.wsolLamports !== "0")) {
    const built = await buildSolCollection({ creator: parent.deployerAddress, ammVaultExists: vaults.ammVaultExists });
    if (!built.ok) return { ok: false, code: "program" };
    const latest = input.chain.latestBlockhash ? await input.chain.latestBlockhash() : null;
    const blockhash = latest?.blockhash ?? await input.chain.blockhash();
    const sent = await broadcast({
      secret,
      expectedAddress: input.expectedAddress,
      suspended: input.suspended,
      parent,
      control,
      intent: { key: collectKey, kind: "collect", amount: "0" },
      transaction: { feePayer: parent.deployerAddress, recentBlockhash: blockhash, instructions: bare(built.instructions) },
      chain: input.chain,
      store: input.store,
      lookup,
      validityHeight: latest?.lastValidBlockHeight ?? null,
    });
    if (!sent.ok) return sent;
    if (sent.observed.status === "failed") return { ok: false, code: "failed" };
    const settled = await settleCollection({ parent, observed: sent.observed, signature: sent.signature, store: input.store });
    if (!settled.ok) {
      await input.store.markIntent(parent.mintAddress, parent.scope, collectKey, "unreconciled", sent.signature);
      return settled;
    }
    await input.store.markIntent(parent.mintAddress, parent.scope, collectKey, "confirmed", sent.signature);
  }
  const key = windowKey(parent.mintAddress, parent.scope, input.nowMs);
  if (!key) return { ok: false, code: "parent" };
  const allocation = await input.store.allocateUnallocated({
    parentMint: parent.mintAddress,
    scope: parent.scope,
    windowKey: key,
    reserveLamports: control.reserveLamports,
  });
  if (!allocation.ok) return { ok: false, code: "unreconciled" };
  if (allocation.state === "empty") return { ok: true, stage: "idle", netLamports: "0", tokenCredited: "0" };
  if (allocation.state === "reserved") return { ok: true, stage: "collected", netLamports: "0", tokenCredited: "0" };
  const holders = allocation.holders;
  const net = allocation.base;
  if (holders !== "0") {
    const existingSnaps = await input.store.snapshots(parent.mintAddress, parent.scope, key);
    if (existingSnaps.length === 0) {
      const curve = bondingCurveAddress(parent.mintAddress);
      const observedHolders = await input.chain.holders(parent.mintAddress, parent.tokenProgram);
      if (!observedHolders) return { ok: false, code: "unreconciled" };
      const snap = snapshotHolders({
        parentMint: parent.mintAddress,
        decimals: parent.decimals,
        accounts: observedHolders.accounts,
        excludedOwners: [parent.deployerAddress, ...(curve ? [curve] : [])],
        solLamports: holders,
        tokenAmount: "0",
      });
      if (!snap.ok) return { ok: false, code: "parent" };
      if (snap.holders.length === 0) {
        return { ok: true, stage: "collected", netLamports: net, tokenCredited: "0", holderPolicy: "no_eligible_holders" };
      }
      await input.store.saveSnapshots(parent.mintAddress, parent.scope, key, snap.holders.map((holder) => ({
        owner: holder.owner,
        balance: holder.balance,
        solLamports: holder.solLamports,
        tokenAmount: holder.tokenAmount,
        cutoffSlot: observedHolders.observedSlot,
      })));
    }
  }
  return { ok: true, stage: "collected", netLamports: net, tokenCredited: "0" };
}

export async function submitClaim(input: {
  loopEnabled: boolean;
  authorised: boolean;
  suspended: boolean;
  secret: string | null;
  expectedAddress: string;
  scope: "test" | "production";
  parentMint: string;
  claimant: string;
  asset: "sol" | "trest";
  amount: string;
  idempotencyKey: string;
  message: string;
  signature: string;
  domain?: string;
  nowMs?: number;
  rewardsActive?: boolean;
  shuttingDown?: boolean;
  store: RewardsStore;
  chain: Chain;
}): Promise<{ ok: true; signature: string } | { ok: false; code: CycleCode | "duplicate" | "ownership" | "amount" }> {
  if (input.shuttingDown || shutdownRequested()) return { ok: false, code: "inactive" };
  if (!rewardsExecutionEnabled({
    loopEnabled: input.loopEnabled ? "true" : "false",
    executionAuthorised: input.authorised ? "true" : "false",
    suspended: input.suspended,
  })) {
    return { ok: false, code: "inactive" };
  }
  if (input.scope === "test") {
    const rehearsal = await input.store.rehearsalState(input.parentMint, input.scope);
    if (!rehearsal || !rehearsal.claimsAllowed) return { ok: false, code: "rehearsal" };
  }
  const bound = parseBoundClaim(input.message);
  const expected = bound
    ? boundClaimMessage({
        domain: bound.domain,
        scope: input.scope,
        parentMint: input.parentMint,
        claimant: input.claimant,
        asset: input.asset,
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
        nonce: bound.nonce,
        expiresAt: bound.expiresAt,
      })
    : claimAuthorizationMessage({
        scope: input.scope,
        parentMint: input.parentMint,
        claimant: input.claimant,
        asset: input.asset,
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
      });
  if (!expected || expected !== input.message) return { ok: false, code: "ownership" };
  if (bound && (input.domain !== bound.domain || !Number.isInteger(input.nowMs) || (input.nowMs ?? 0) >= bound.expiresAt)) {
    return { ok: false, code: "ownership" };
  }
  const proof = verifyClaimOwnership({ message: input.message, signature: input.signature, claimant: input.claimant });
  if (!proof.ok) return proof;
  const parent = await input.store.parent(input.scope);
  if (!parent || parent.mintAddress !== input.parentMint || parent.deployerAddress !== input.expectedAddress) return { ok: false, code: "parent" };
  if (input.scope === "production" && (parent.scope !== "production" || parent.symbol !== "SDK" || parent.mintAddress === TREST_MINT)) {
    return { ok: false, code: "parent" };
  }
  if (input.scope === "production" && input.rewardsActive !== true) return { ok: false, code: "inactive" };
  const derived = input.secret ? derivedDeployerAddress(input.secret) : null;
  if (!derived || derived !== parent.deployerAddress) return { ok: false, code: "signer_mismatch" };
  const control = await input.store.control(parent.mintAddress, parent.scope);
  if (!control || control.suspended) return { ok: false, code: "suspended" };
  const windows = await input.store.windows(parent.mintAddress, parent.scope);
  let entitlement = BigInt(0);
  for (const window of windows) {
    const rows = await input.store.snapshots(parent.mintAddress, parent.scope, window.windowKey);
    const row = rows.find((item) => item.owner === input.claimant);
    if (!row) continue;
    entitlement += BigInt(input.asset === "sol" ? row.solLamports : row.tokenAmount);
  }
  const prior = await input.store.claims(parent.mintAddress, parent.scope);
  const existing = prior.find((claim) => claim.idempotencyKey === input.idempotencyKey);
  if (existing?.status === "confirmed") return { ok: false, code: "duplicate" };
  if (existing?.signature && (existing.status === "uncertain" || existing.status === "submitted" || existing.status === "unreconciled")) {
    if (input.asset === "sol") {
      return settleStoredSolClaim({
        store: input.store,
        chain: input.chain,
        parentMint: parent.mintAddress,
        scope: parent.scope,
        deployer: parent.deployerAddress,
        claimant: input.claimant,
        lamports: input.amount,
        idempotencyKey: input.idempotencyKey,
        signature: existing.signature,
      });
    }
    const vaults = await readCreatorVaults(input.chain, parent.deployerAddress);
    const observed = await input.chain.transaction(existing.signature, {
      creator: parent.deployerAddress,
      solVault: vaults.ok ? vaults.solVault : parent.deployerAddress,
      wsolVault: vaults.ok ? vaults.wsolVault : parent.deployerAddress,
      parentMint: parent.mintAddress,
      destination: input.claimant,
    });
    if (!observed || observed.status === "uncertain") return { ok: false, code: "uncertain" };
    if (observed.status === "failed") {
      await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "failed", existing.signature);
      return { ok: false, code: "failed" };
    }
    const received = BigInt(observed.destinationTokenDelta);
    if (received < BigInt(input.amount)) {
      await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "unreconciled", existing.signature);
      return { ok: false, code: "unreconciled" };
    }
    const marked = await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "confirmed", existing.signature);
    if (marked !== "ok") return { ok: false, code: "uncertain" };
    return { ok: true, signature: existing.signature };
  }
  if (existing) return { ok: false, code: "duplicate" };
  const claimed = prior
    .filter((claim) => claim.claimant === input.claimant && claim.asset === input.asset && claim.status === "confirmed")
    .reduce((sum, claim) => sum + BigInt(claim.amount), BigInt(0));
  if (claimed + BigInt(input.amount) > entitlement) return { ok: false, code: "amount" };
  const wallet = await input.chain.account(parent.deployerAddress);
  const obligations = await input.store.solObligations(parent.mintAddress, parent.scope);
  const deferredHold = BigInt(obligations.deferredHolderLamports) + BigInt(obligations.deferredBuybackLamports) + BigInt(obligations.deferredDeployerLamports);
  if (!wallet || BigInt(wallet.lamports) < BigInt(input.amount) + BigInt(control.reserveLamports) + deferredHold) return { ok: false, code: "unfunded" };
  const instruction = input.asset === "sol"
    ? buildSolClaim({
        parentMint: parent.mintAddress,
        claimParentMint: input.parentMint,
        deployer: parent.deployerAddress,
        claimant: input.claimant,
        amountLamports: input.amount,
        entitlementLamports: entitlement.toString(),
        alreadyClaimedLamports: claimed.toString(),
        idempotencyKey: input.idempotencyKey,
        uncertainKeys: prior.filter((claim) => claim.asset === "sol" && (claim.status === "uncertain" || claim.status === "unreconciled")).map((claim) => claim.idempotencyKey),
      })
    : buildTokenClaim({
        parentMint: parent.mintAddress,
        claimMint: input.parentMint,
        tokenProgram: parent.tokenProgram,
        deployer: parent.deployerAddress,
        claimant: input.claimant,
        amount: input.amount,
        decimals: parent.decimals,
        entitlement: entitlement.toString(),
        alreadyClaimed: claimed.toString(),
        idempotencyKey: input.idempotencyKey,
        uncertainKeys: prior.filter((claim) => claim.asset === "trest" && (claim.status === "uncertain" || claim.status === "unreconciled")).map((claim) => claim.idempotencyKey),
      });
  if (!instruction.ok) return { ok: false, code: instruction.code === "unfunded" ? "amount" : instruction.code === "uncertain" ? "uncertain" : "parent" };
  const saved = await input.store.saveClaim({
    claimant: input.claimant,
    asset: input.asset,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    status: "recorded",
    signature: null,
    scope: parent.scope,
    parentMint: parent.mintAddress,
    proofHash: proof.proofHash,
  });
  if (saved !== "ok") return { ok: false, code: saved };
  const blockhash = await input.chain.blockhash();
  const transaction = { feePayer: parent.deployerAddress, recentBlockhash: blockhash, instructions: [instruction.instruction] };
  const signed = signInspected({
    secret: input.secret ?? "",
    expectedAddress: input.expectedAddress,
    suspended: input.suspended,
    transaction,
    policy: {
      kind: input.asset === "sol" ? "claim_sol" : "claim_token",
      scope: parent.scope,
      parentMint: parent.mintAddress,
      deployer: parent.deployerAddress,
      recipient: input.claimant,
      maxLamports: input.amount,
      maxRentLamports: "0",
      tokenProgram: parent.tokenProgram,
    },
  });
  if (!signed.ok) return { ok: false, code: signed.code };
  await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "submitted", signed.signature);
  const wire = signedTransactionWire(transaction, signed.signature);
  if (!wire) return { ok: false, code: "transaction" };
  if (input.shuttingDown || shutdownRequested()) {
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "failed", signed.signature);
    return { ok: false, code: "inactive" };
  }
  const sent = await input.chain.submit(wire);
  if (sent.status !== "accepted") {
    const definitive = sent.status === "preflight" || sent.status === "rejected" || sent.status === "expired";
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, definitive ? "failed" : "uncertain", signed.signature);
    return { ok: false, code: definitive ? "failed" : "uncertain" };
  }
  if (input.asset === "sol") {
    return settleStoredSolClaim({
      store: input.store,
      chain: input.chain,
      parentMint: parent.mintAddress,
      scope: parent.scope,
      deployer: parent.deployerAddress,
      claimant: input.claimant,
      lamports: input.amount,
      idempotencyKey: input.idempotencyKey,
      signature: signed.signature,
    });
  }
  const vaults = await readCreatorVaults(input.chain, parent.deployerAddress);
  const lookup: VaultLookup = {
    creator: parent.deployerAddress,
    solVault: vaults.ok ? vaults.solVault : parent.deployerAddress,
    wsolVault: vaults.ok ? vaults.wsolVault : parent.deployerAddress,
    parentMint: parent.mintAddress,
    destination: input.claimant,
  };
  const observed = await input.chain.transaction(signed.signature, lookup);
  if (!observed || observed.status !== "confirmed") {
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, observed?.status === "failed" ? "failed" : "uncertain", signed.signature);
    return { ok: false, code: observed?.status === "failed" ? "failed" : "uncertain" };
  }
  const received = BigInt(observed.destinationTokenDelta);
  if (received < BigInt(input.amount)) {
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "unreconciled", signed.signature);
    return { ok: false, code: "unreconciled" };
  }
  await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "confirmed", signed.signature);
  return { ok: true, signature: signed.signature };
}

async function confirmedSignatureUsed(
  store: RewardsStore,
  parentMint: string,
  scope: "test" | "production",
  signature: string,
  idempotencyKey: string,
): Promise<boolean> {
  const claims = await store.claims(parentMint, scope);
  return claims.some((claim) => claim.signature === signature && claim.idempotencyKey !== idempotencyKey && claim.status === "confirmed");
}

async function settleStoredSolClaim(input: {
  store: RewardsStore;
  chain: Chain;
  parentMint: string;
  scope: "test" | "production";
  deployer: string;
  claimant: string;
  lamports: string;
  idempotencyKey: string;
  signature: string;
}): Promise<{ ok: true; signature: string } | { ok: false; code: "uncertain" | "failed" | "unreconciled" }> {
  const verdict = input.chain.solClaim
    ? await input.chain.solClaim(input.signature, { deployer: input.deployer, claimant: input.claimant, lamports: input.lamports })
    : { status: "unconfirmed" as const };
  if (verdict.status === "confirmed") {
    if (await confirmedSignatureUsed(input.store, input.parentMint, input.scope, input.signature, input.idempotencyKey)) {
      await input.store.markClaim(input.parentMint, input.scope, input.idempotencyKey, "unreconciled", input.signature);
      return { ok: false, code: "unreconciled" };
    }
    const marked = await input.store.markClaim(input.parentMint, input.scope, input.idempotencyKey, "confirmed", input.signature);
    if (marked !== "ok") return { ok: false, code: "uncertain" };
    return { ok: true, signature: input.signature };
  }
  if (verdict.status === "failed") {
    await input.store.markClaim(input.parentMint, input.scope, input.idempotencyKey, "failed", input.signature);
    return { ok: false, code: "failed" };
  }
  if (verdict.status === "mismatch") {
    await input.store.markClaim(input.parentMint, input.scope, input.idempotencyKey, "unreconciled", input.signature);
    return { ok: false, code: "unreconciled" };
  }
  await input.store.markClaim(input.parentMint, input.scope, input.idempotencyKey, "uncertain", input.signature);
  return { ok: false, code: "uncertain" };
}

export async function reconcileStoredSolClaims(input: {
  store: RewardsStore;
  chain: Chain;
  parentMint: string;
  deployer: string;
}): Promise<{ confirmed: number; unresolved: number }> {
  const claims = await input.store.claims(input.parentMint, "test");
  const usedSignatures = new Set(claims.flatMap((claim) => claim.status === "confirmed" && claim.signature ? [claim.signature] : []));
  let confirmed = 0;
  let unresolved = 0;
  for (const claim of claims) {
    if (claim.asset !== "sol" || claim.scope !== "test" || !claim.signature) continue;
    if (claim.status !== "submitted" && claim.status !== "uncertain" && claim.status !== "unreconciled") continue;
    const verdict = input.chain.solClaim
      ? await input.chain.solClaim(claim.signature, { deployer: input.deployer, claimant: claim.claimant, lamports: claim.amount })
      : { status: "unconfirmed" as const };
    if (verdict.status === "confirmed") {
      if (usedSignatures.has(claim.signature)) {
        await input.store.markClaim(input.parentMint, "test", claim.idempotencyKey, "unreconciled", claim.signature);
        unresolved += 1;
        continue;
      }
      const marked = await input.store.markClaim(input.parentMint, "test", claim.idempotencyKey, "confirmed", claim.signature);
      if (marked === "ok") {
        confirmed += 1;
        usedSignatures.add(claim.signature);
      }
      continue;
    }
    if (verdict.status === "failed") {
      await input.store.markClaim(input.parentMint, "test", claim.idempotencyKey, "failed", claim.signature);
      continue;
    }
    if (verdict.status === "mismatch") {
      await input.store.markClaim(input.parentMint, "test", claim.idempotencyKey, "unreconciled", claim.signature);
    }
    unresolved += 1;
  }
  return { confirmed, unresolved };
}
