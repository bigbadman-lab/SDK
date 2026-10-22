import { associatedTokenAddress } from "../../../lib/rewards/claim.ts";
import { inspectRewardsTransaction, messageSha256, signedTransactionWire, transactionMessage, type CompiledTransaction } from "../../../lib/rewards/inspect.ts";
import { quoteInsideBuybackBudget, reservedBuybackSpendAllowed } from "../../../lib/rewards/ledger.ts";
import { derivedDeployerAddress, signInspected } from "../../../lib/rewards/signer.ts";
import { pollTransactionConfirmation, type Chain, type ObservedTransaction, type SignatureObservation } from "./chain.ts";
import { CONFIRMED_COLLECTION } from "./collection-recovery.ts";
import { buildCurveBuyback, type BuiltInstruction } from "./instructions.ts";
import {
  DEFERRED_BUYBACK_BUDGET,
  DEFERRED_BUYBACK_KEY,
  DEFERRED_COLLECTION_SIGNATURE,
  TREST_REHEARSAL_MINT,
  type RewardsStore,
} from "./store.ts";

export const DEFERRED_BUYBACK_APPROVAL = "TREST-FIRST-BUYBACK";
const LOCK_HOLDER = "deferred-buyback";
const TOKEN_ACCOUNT_BYTES = 165;
const BASE_SIGNATURE_FEE = BigInt(5000);
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const BUY_DISCRIMINATOR = [225, 247, 80, 30, 213, 179, 132, 136];
const AMM_BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];

export type DeferredBuybackCode =
  | "approval"
  | "budget"
  | "failed"
  | "locked"
  | "parent"
  | "rehearsal"
  | "signer_mismatch"
  | "spend"
  | "suspended"
  | "transaction"
  | "uncertain"
  | "unfunded"
  | "unreconciled";

export type DeferredBuybackResult =
  | { ok: true; duplicate: boolean; signature: string; solSpent: string; tokenAmount: string }
  | { ok: false; code: DeferredBuybackCode };

type SignResult = { ok: true; signature: string } | { ok: false; code: string };

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameBytes(data: readonly number[], discriminator: readonly number[]): boolean {
  return discriminator.every((byte, index) => data[index] === byte);
}

function readU32(data: readonly number[], offset: number): bigint | null {
  if (data.length < offset + 4) return null;
  return BigInt((data[offset] ?? 0) + (data[offset + 1] ?? 0) * 256 + (data[offset + 2] ?? 0) * 65536 + (data[offset + 3] ?? 0) * 16777216);
}

function readU64(data: readonly number[], offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) value += BigInt(data[offset + index] ?? 0) << BigInt(8 * index);
  return value;
}

function networkFeeLamports(instructions: readonly BuiltInstruction[]): bigint {
  let units: bigint | null = null;
  let price: bigint | null = null;
  for (const instruction of instructions) {
    if (instruction.programId !== COMPUTE_BUDGET_PROGRAM_ID) continue;
    if (instruction.data[0] === 2) units = readU32(instruction.data, 1);
    if (instruction.data[0] === 3) price = readU64(instruction.data, 1);
  }
  const priority = units !== null && price !== null ? (units * price + BigInt(999_999)) / BigInt(1_000_000) : BigInt(0);
  return BASE_SIGNATURE_FEE + priority;
}

function systemTransferLamports(instructions: readonly BuiltInstruction[]): bigint {
  return instructions.reduce((total, instruction) => {
    if (instruction.programId !== SYSTEM_PROGRAM_ID || instruction.data[0] !== 2) return total;
    return total + (readU64(instruction.data, 4) ?? BigInt(0));
  }, BigInt(0));
}

function encodedQuoteLamports(instructions: readonly BuiltInstruction[]): bigint | null {
  let quote = BigInt(0);
  let found = false;
  for (const instruction of instructions) {
    if (sameBytes(instruction.data, BUY_DISCRIMINATOR)) {
      const amount = readU64(instruction.data, 8);
      if (amount === null) return null;
      quote += amount;
      found = true;
    }
    if (sameBytes(instruction.data, AMM_BUY_DISCRIMINATOR)) {
      const amount = readU64(instruction.data, 16);
      if (amount === null) return null;
      quote += amount;
      found = true;
    }
  }
  return found ? quote : null;
}

function solSpentLamports(delta: string): bigint | null {
  if (!/^-[1-9][0-9]{0,18}$/.test(delta)) return null;
  return BigInt(delta.slice(1));
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

export async function executeDeferredBuyback(input: {
  authorised: boolean;
  approval: string;
  secret: string;
  store: RewardsStore;
  chain: Chain;
  sign?: (transaction: CompiledTransaction, policyMaxLamports: string, policyMaxRentLamports: string) => SignResult;
}): Promise<DeferredBuybackResult> {
  if (!input.authorised || input.approval !== DEFERRED_BUYBACK_APPROVAL) return { ok: false, code: "approval" };
  if (input.sign && process.env.NODE_TEST_CONTEXT === undefined) return { ok: false, code: "approval" };
  const parent = await input.store.parent("test");
  if (
    !parent
    || parent.mintAddress !== TREST_REHEARSAL_MINT
    || parent.deployerAddress !== CONFIRMED_COLLECTION.deployer
    || parent.symbol !== "TREST"
    || parent.scope !== "test"
  ) return { ok: false, code: "parent" };
  const derived = derivedDeployerAddress(input.secret);
  if (!input.sign && (!derived || derived !== parent.deployerAddress)) return { ok: false, code: "signer_mismatch" };
  const control = await input.store.control(parent.mintAddress, parent.scope);
  if (!control?.suspended) return { ok: false, code: "suspended" };
  const rehearsal = await input.store.rehearsalState(parent.mintAddress, parent.scope);
  if (!rehearsal || rehearsal.status !== "stopped") return { ok: false, code: "rehearsal" };
  const holder = `${LOCK_HOLDER}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const lease = await input.store.tryLock(parent.mintAddress, parent.scope, holder, Date.now());
  if (lease === "locked") return { ok: false, code: "locked" };
  try {
    const preview = (await input.store.intents(parent.mintAddress, parent.scope)).find((intent) => intent.idempotencyKey === DEFERRED_BUYBACK_KEY);
    if (preview?.status === "confirmed") {
      if (!preview.signature || !preview.tokenAmount || !preview.amountLamports) return { ok: false, code: "unreconciled" };
      return { ok: true, duplicate: true, signature: preview.signature, solSpent: preview.amountLamports, tokenAmount: preview.tokenAmount };
    }
    if (preview && (preview.status === "submitted" || preview.status === "uncertain" || preview.status === "unreconciled")) {
      return reconcile(input.store, input.chain, parent.deployerAddress);
    }
    const obligations = await input.store.solObligations(parent.mintAddress, parent.scope);
    const holderLiability = BigInt(obligations.holderSol);
    const holderPaid = BigInt(obligations.confirmedHolderSol);
    const unpaidHolders = holderLiability > holderPaid ? holderLiability - holderPaid : BigInt(0);
    const recordedBuyback = BigInt(obligations.buybackSol);
    const confirmedBuyback = BigInt(obligations.confirmedBuybackSol);
    const wallet = await input.chain.account(parent.deployerAddress);
    const covered = reservedBuybackSpendAllowed({
      walletLamports: wallet?.lamports ?? "0",
      spendLamports: DEFERRED_BUYBACK_BUDGET,
      budgetLamports: DEFERRED_BUYBACK_BUDGET,
      pendingLamports: "0",
      reserveLamports: control.reserveLamports,
      unpaidHolderLamports: unpaidHolders.toString(),
      deployerRetainedLamports: obligations.deployerRetained,
      unspentPriorBuybackLamports: (recordedBuyback > confirmedBuyback ? recordedBuyback - confirmedBuyback : BigInt(0)).toString(),
      deferredHolderLamports: obligations.deferredHolderLamports,
      deferredBuybackLamports: obligations.deferredBuybackLamports,
      deferredDeployerLamports: obligations.deferredDeployerLamports,
    });
    if (!covered.ok) return { ok: false, code: covered.code === "budget" ? "budget" : "unfunded" };
    if (
      obligations.deferredHolderLamports !== CONFIRMED_COLLECTION.holders
      || obligations.deferredDeployerLamports !== CONFIRMED_COLLECTION.deployerRetained
      || obligations.deferredBuybackLamports !== DEFERRED_BUYBACK_BUDGET
    ) return { ok: false, code: "unfunded" };
    if (preview?.status === "failed") {
      if ((await input.store.reopenFailedDeferredBuyback({
        parentMint: parent.mintAddress,
        scope: parent.scope,
        idempotencyKey: DEFERRED_BUYBACK_KEY,
        budgetLamports: DEFERRED_BUYBACK_BUDGET,
      })) !== "ok") return { ok: false, code: "uncertain" };
    }
    const held = await input.store.holdDeferredBuyback({
      parentMint: parent.mintAddress,
      scope: parent.scope,
      idempotencyKey: DEFERRED_BUYBACK_KEY,
      budgetLamports: DEFERRED_BUYBACK_BUDGET,
      collectionSignature: DEFERRED_COLLECTION_SIGNATURE,
    });
    if (held === "pending") return reconcile(input.store, input.chain, parent.deployerAddress);
    if (held === "settled") {
      if (!preview?.signature || !preview.amountLamports || !preview.tokenAmount) return { ok: false, code: "unreconciled" };
      return { ok: true, duplicate: true, signature: preview.signature, solSpent: preview.amountLamports, tokenAmount: preview.tokenAmount };
    }
    if (held !== "held" && held !== "resume") return { ok: false, code: "unreconciled" };
    const destination = associatedTokenAddress(parent.deployerAddress, parent.mintAddress, parent.tokenProgram);
    if (!destination) return { ok: false, code: "parent" };
    const existingTokenAccount = await input.chain.account(destination);
    const rent = existingTokenAccount ? BigInt(0) : BigInt(await input.chain.rent(TOKEN_ACCOUNT_BYTES));
    const market = await input.chain.market(parent.mintAddress);
    if (!market || market.graduated !== parent.graduated) return { ok: false, code: "unreconciled" };
    const latest = input.chain.latestBlockhash ? await input.chain.latestBlockhash() : null;
    const blockhash = latest?.blockhash ?? await input.chain.blockhash();
    const built = await buildAffordableBuyback({
      parent,
      controlSlippage: control.slippageBps,
      market,
      rent,
      budget: BigInt(DEFERRED_BUYBACK_BUDGET),
    });
    if (!built.ok) return { ok: false, code: built.code };
    const transaction: CompiledTransaction = {
      feePayer: parent.deployerAddress,
      recentBlockhash: blockhash,
      instructions: built.instructions.map((instruction) => ({
        programId: instruction.programId,
        keys: instruction.keys,
        data: instruction.data,
      })),
    };
    const policy = {
      kind: "buyback" as const,
      scope: parent.scope,
      parentMint: parent.mintAddress,
      deployer: parent.deployerAddress,
      recipient: parent.deployerAddress,
      maxLamports: built.quote,
      maxRentLamports: built.rent,
      tokenProgram: parent.tokenProgram,
    };
    const inspected = inspectRewardsTransaction(transaction, policy);
    if (!inspected.ok) return { ok: false, code: inspected.code === "spend" ? "spend" : "transaction" };
    const signed = input.sign
      ? input.sign(transaction, built.quote, built.rent)
      : signInspected({
          secret: input.secret,
          expectedAddress: parent.deployerAddress,
          suspended: false,
          transaction,
          policy,
        });
    if (!signed.ok) return { ok: false, code: signed.code === "spend" ? "spend" : "signer_mismatch" };
    const message = transactionMessage(transaction);
    const wire = input.sign ? new Uint8Array([1]) : signedTransactionWire(transaction, signed.signature);
    if (!message || !wire || messageSha256(message).length !== 64) return { ok: false, code: "transaction" };
    const marked = await input.store.markIntent(parent.mintAddress, parent.scope, DEFERRED_BUYBACK_KEY, "submitted", signed.signature);
    if (marked !== "ok") return { ok: false, code: "uncertain" };
    const noted = await input.store.recordSubmission(parent.mintAddress, parent.scope, DEFERRED_BUYBACK_KEY, {
      recentBlockhash: blockhash,
      submissionCode: "confirmation_pending",
      submissionDetail: validityNote(latest?.lastValidBlockHeight ?? null, "signature stored before submission"),
    });
    if (noted !== "ok") return { ok: false, code: "uncertain" };
    const sent = await input.chain.submit(wire);
    if (sent.status !== "accepted") {
      const definitive = sent.status === "preflight" || sent.status === "rejected" || sent.status === "expired";
      const status = definitive ? "failed" : "uncertain";
      const failed = await input.store.markIntent(parent.mintAddress, parent.scope, DEFERRED_BUYBACK_KEY, status, signed.signature);
      if (failed !== "ok") return { ok: false, code: "uncertain" };
      return { ok: false, code: definitive ? "failed" : "uncertain" };
    }
    return reconcile(input.store, input.chain, parent.deployerAddress);
  } finally {
    await input.store.unlock(parent.mintAddress, parent.scope, holder);
  }
}

async function buildAffordableBuyback(input: {
  parent: { mintAddress: string; deployerAddress: string; tokenProgram: string };
  controlSlippage: number;
  market: NonNullable<Awaited<ReturnType<Chain["market"]>>>;
  rent: bigint;
  budget: bigint;
}): Promise<{ ok: true; instructions: BuiltInstruction[]; quote: string; rent: string } | { ok: false; code: "budget" | "unreconciled" }> {
  let fee = BASE_SIGNATURE_FEE;
  let transfers = BigInt(0);
  let instructions: BuiltInstruction[] | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const priced = quoteInsideBuybackBudget({
      budgetLamports: input.budget.toString(),
      networkFeeLamports: (fee + transfers).toString(),
      rentLamports: input.rent.toString(),
    });
    if (!priced.ok) return { ok: false, code: "budget" };
    const built = await buildCurveBuyback({
      parentMint: input.parent.mintAddress,
      deployer: input.parent.deployerAddress,
      tokenProgram: input.parent.tokenProgram,
      quoteLamports: priced.quoteLamports,
      minimumTokens: "1",
      slippageBps: input.controlSlippage,
      graduated: input.market.graduated,
      pool: input.market.graduated ? input.market.pool : null,
      curve: input.market.graduated ? null : input.market.curve,
    });
    if (!built.ok) return { ok: false, code: "unreconciled" };
    instructions = built.instructions;
    fee = networkFeeLamports(built.instructions);
    transfers = systemTransferLamports(built.instructions);
    const encoded = encodedQuoteLamports(built.instructions);
    if (encoded === null || encoded + fee + transfers + input.rent > input.budget) continue;
    if (encoded > BigInt(priced.quoteLamports)) continue;
    return { ok: true, instructions, quote: encoded.toString(), rent: (transfers + input.rent).toString() };
  }
  return { ok: false, code: "budget" };
}

async function reconcile(store: RewardsStore, chain: Chain, deployer: string): Promise<DeferredBuybackResult> {
  const intent = (await store.intents(TREST_REHEARSAL_MINT, "test")).find((row) => row.idempotencyKey === DEFERRED_BUYBACK_KEY);
  if (!intent?.signature) return { ok: false, code: "uncertain" };
  if (intent.status === "confirmed" && intent.amountLamports && intent.tokenAmount) {
    return { ok: true, duplicate: true, signature: intent.signature, solSpent: intent.amountLamports, tokenAmount: intent.tokenAmount };
  }
  const lookup = { creator: deployer, solVault: deployer, wsolVault: deployer, parentMint: TREST_REHEARSAL_MINT, destination: deployer };
  const polled = await pollTransactionConfirmation({
    read: () => chain.transaction(intent.signature ?? "", lookup),
    status: () => chain.signatureStatus?.(intent.signature ?? "") ?? Promise.resolve("unknown" satisfies SignatureObservation),
    wait: chain.pace ?? pause,
  });
  if (polled.kind === "failed" || (polled.kind === "observed" && polled.observed.status === "failed")) {
    const marked = await store.markIntent(TREST_REHEARSAL_MINT, "test", DEFERRED_BUYBACK_KEY, "failed", intent.signature);
    return marked === "ok" ? { ok: false, code: "failed" } : { ok: false, code: "uncertain" };
  }
  const observed = polled.kind === "observed" ? polled.observed : null;
  const finalized = observed?.status === "confirmed"
    ? await readOrUnknown(() => chain.signatureStatus?.(intent.signature ?? "") ?? Promise.resolve("unknown" as const), "unknown" as const)
    : "unknown";
  if (observed?.status === "confirmed" && finalized === "finalized") return settleObserved(store, intent.signature, observed);
  const absent = observed ? "present" : await readOrUnknown(() => chain.signatureState(intent.signature ?? ""), "unknown");
  const blockhashState = !observed && absent === "absent" && intent.recentBlockhash
    ? await readOrUnknown(() => chain.blockhashValid(intent.recentBlockhash ?? ""), "unknown")
    : "unknown";
  const height = storedValidityHeight(intent.submissionDetail);
  const blockHeight = !observed && absent === "absent" && chain.blockHeight ? await readOrUnknown(() => chain.blockHeight?.() ?? Promise.resolve(null), null) : null;
  const expired = blockhashState === "expired" || (height !== null && blockHeight !== null && /^[0-9]+$/.test(blockHeight) && BigInt(blockHeight) > BigInt(height));
  if (!observed && absent === "absent" && expired) {
    const marked = await store.markIntent(TREST_REHEARSAL_MINT, "test", DEFERRED_BUYBACK_KEY, "failed", intent.signature);
    return marked === "ok" ? { ok: false, code: "failed" } : { ok: false, code: "uncertain" };
  }
  if (intent.status !== "unreconciled") {
    await store.markIntent(TREST_REHEARSAL_MINT, "test", DEFERRED_BUYBACK_KEY, "uncertain", intent.signature);
  }
  return { ok: false, code: "uncertain" };
}

async function settleObserved(store: RewardsStore, signature: string, observed: ObservedTransaction): Promise<DeferredBuybackResult> {
  const spent = solSpentLamports(observed.creatorDelta);
  const tokens = /^[1-9][0-9]*$/.test(observed.tokenDelta) ? BigInt(observed.tokenDelta) : null;
  if (
    observed.feePayer !== CONFIRMED_COLLECTION.deployer
    || spent === null
    || tokens === null
    || spent > BigInt(DEFERRED_BUYBACK_BUDGET)
    || observed.destinationTokenDelta !== observed.tokenDelta
  ) {
    await store.markIntent(TREST_REHEARSAL_MINT, "test", DEFERRED_BUYBACK_KEY, "unreconciled", signature);
    return { ok: false, code: "unreconciled" };
  }
  const settled = await store.settleDeferredBuyback({
    parentMint: TREST_REHEARSAL_MINT,
    scope: "test",
    idempotencyKey: DEFERRED_BUYBACK_KEY,
    signature,
    solSpentLamports: spent.toString(),
    tokenAmount: tokens.toString(),
    budgetLamports: DEFERRED_BUYBACK_BUDGET,
  });
  if (settled !== "ok") return { ok: false, code: "uncertain" };
  const obligations = await store.solObligations(TREST_REHEARSAL_MINT, "test");
  if (
    obligations.deferredHolderLamports !== CONFIRMED_COLLECTION.holders
    || obligations.deferredDeployerLamports !== CONFIRMED_COLLECTION.deployerRetained
    || BigInt(obligations.deferredBuybackLamports) !== BigInt(DEFERRED_BUYBACK_BUDGET) - spent
  ) return { ok: false, code: "unreconciled" };
  return { ok: true, duplicate: false, signature, solSpent: spent.toString(), tokenAmount: tokens.toString() };
}
