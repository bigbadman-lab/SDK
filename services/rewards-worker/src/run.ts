import { accountingWindow, authoriseBucketSpend, buybackSpendAllowed } from "../../../lib/rewards/ledger.ts";
import { buildSolClaim, buildTokenClaim } from "../../../lib/rewards/claim.ts";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { buybackBlocked, windowKey } from "../../../lib/rewards/cycle.ts";
import { messageSha256, signedTransactionWire, type CompiledTransaction } from "../../../lib/rewards/inspect.ts";
import { snapshotHolders } from "../../../lib/rewards/holders.ts";
import { boundClaimMessage, claimAuthorizationMessage, parseBoundClaim, verifyClaimOwnership } from "../../../lib/rewards/ownership.ts";
import { explainCreatorDelta, reconcileBuyback, reconcileCreatorFee } from "../../../lib/rewards/reconcile.ts";
import { derivedDeployerAddress, rewardsExecutionEnabled } from "../../../lib/rewards/signer.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { bondingCurveAddress, readCreatorVaults, type Chain, type ObservedTransaction, type VaultLookup } from "./chain.ts";
import { buildCurveBuyback, buildSolCollection, type BuiltInstruction } from "./instructions.ts";
import type { RegisteredParent, RewardControl, RewardsStore, StoredIntent } from "./store.ts";

const RENT_CAP = "50000000";

function boundedBuyQuote(budget: string, slippageBps: number): string {
  const cap = BigInt(budget);
  const scale = BigInt(10_000 + slippageBps);
  let quote = (cap * BigInt(10_000)) / scale;
  if (quote <= BigInt(0)) return "1";
  while ((quote * scale + BigInt(9_999)) / BigInt(10_000) > cap && quote > BigInt(1)) quote -= BigInt(1);
  return quote.toString();
}
const FEE_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";

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

export type CycleResult = { ok: true; stage: "idle" | "collected" | "bought" | "recovered"; netLamports: string; tokenCredited: string } | { ok: false; code: CycleCode };

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
}): Promise<{ ok: true; observed: ObservedTransaction; signature: string } | { ok: false; code: CycleCode }> {
  const recorded = await input.store.recordIntent({
    idempotencyKey: input.intent.key,
    parentMint: input.parent.mintAddress,
    scope: input.parent.scope,
    kind: input.intent.kind,
    amountLamports: input.intent.amount,
    tokenAmount: null,
    messageSha256: null,
  });
  if (recorded === "duplicate") {
    const existing = (await input.store.intents(input.parent.mintAddress, input.parent.scope)).find((intent) => intent.idempotencyKey === input.intent.key);
    if (existing?.signature) return { ok: false, code: "uncertain" };
  }
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
  const wire = signedTransactionWire(input.transaction, signed.signature);
  if (!wire || messageSha256(signed.message).length !== 64) return { ok: false, code: "transaction" };
  const sent = await input.chain.submit(wire);
  if (sent === "uncertain") {
    await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "uncertain", signed.signature);
    return { ok: false, code: "uncertain" };
  }
  const observed = await input.chain.transaction(signed.signature, input.lookup);
  if (!observed || observed.status === "uncertain") {
    await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "uncertain", signed.signature);
    return { ok: false, code: "uncertain" };
  }
  if (observed.status === "failed") {
    await input.store.markIntent(input.parent.mintAddress, input.parent.scope, input.intent.key, "failed", signed.signature);
  }
  return { ok: true, observed, signature: signed.signature };
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
  const lease = await input.store.tryLock(parent.mintAddress, parent.scope, input.holder, input.nowMs);
  if (lease === "locked") return { ok: false, code: "locked" };
  try {
    return await execute(input, parent, control);
  } finally {
    await input.store.unlock(parent.mintAddress, parent.scope, input.holder);
  }
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
  const buyKey = `buyback-${window.startMs}`;
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
  const intents = await input.store.intents(parent.mintAddress, parent.scope);
  const collectIntent = intents.find((intent) => intent.idempotencyKey === collectKey);
  if (collectIntent?.signature) {
    const observed = await input.chain.transaction(collectIntent.signature, lookup);
    if (!observed || observed.status === "uncertain") {
      await input.store.markIntent(parent.mintAddress, parent.scope, collectKey, "uncertain", collectIntent.signature);
      return { ok: false, code: "uncertain" };
    }
    if (observed.status === "confirmed" && collectIntent.status !== "confirmed") {
      const settled = await settleCollection({ parent, observed, signature: collectIntent.signature, store: input.store });
      if (!settled.ok) {
        await input.store.markIntent(parent.mintAddress, parent.scope, collectKey, "unreconciled", collectIntent.signature);
        return settled;
      }
      await input.store.markIntent(parent.mintAddress, parent.scope, collectKey, "confirmed", collectIntent.signature);
    }
    if (observed.status === "failed") {
      await input.store.markIntent(parent.mintAddress, parent.scope, collectKey, "failed", collectIntent.signature);
    }
  } else if ((!collectIntent || !collectIntent.signature) && (vaults.nativeLamports !== "0" || vaults.wsolLamports !== "0")) {
    const built = await buildSolCollection({ creator: parent.deployerAddress, ammVaultExists: vaults.ammVaultExists });
    if (!built.ok) return { ok: false, code: "program" };
    const blockhash = await input.chain.blockhash();
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
  const buyback = allocation.buyback;
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
      await input.store.saveSnapshots(parent.mintAddress, parent.scope, key, snap.holders.map((holder) => ({
        owner: holder.owner,
        balance: holder.balance,
        solLamports: holder.solLamports,
        tokenAmount: holder.tokenAmount,
        cutoffSlot: observedHolders.observedSlot,
      })));
    }
  }
  if (buyback === "0") return { ok: true, stage: "collected", netLamports: net, tokenCredited: "0" };
  const currentIntents = await input.store.intents(parent.mintAddress, parent.scope);
  if (buybackBlocked(currentIntents, parent.mintAddress, parent.scope)) return { ok: false, code: "uncertain" };
  const buyIntent = currentIntents.find((intent) => intent.idempotencyKey === buyKey);
  if (buyIntent?.signature) {
    const observed = await input.chain.transaction(buyIntent.signature, lookup);
    if (!observed || observed.status !== "confirmed") return { ok: false, code: observed?.status === "failed" ? "failed" : "uncertain" };
    const tokens = reconcileBuyback({ status: "confirmed", quotedTokenAmount: "1", tokenDelta: observed.tokenDelta });
    if (!tokens.ok) return { ok: false, code: "unreconciled" };
    return creditTokens(input.store, parent, key, tokens.credited);
  }
  const market = await input.chain.market(parent.mintAddress);
  if (!market || market.graduated !== parent.graduated) return { ok: false, code: "market" };
  const wallet = await input.chain.account(parent.deployerAddress);
  if (!wallet) return { ok: false, code: "unfunded" };
  const obligations = await input.store.solObligations(parent.mintAddress, parent.scope);
  const holderLiability = BigInt(obligations.holderSol);
  const holderPaid = BigInt(obligations.confirmedHolderSol);
  const unpaidHolders = holderLiability > holderPaid ? holderLiability - holderPaid : BigInt(0);
  const unspentPrior = BigInt(obligations.buybackSol) - BigInt(obligations.confirmedBuybackSol) - BigInt(buyback);
  if (unspentPrior < BigInt(0)) return { ok: false, code: "unreconciled" };
  const covered = buybackSpendAllowed({
    walletLamports: wallet.lamports,
    buybackLamports: buyback,
    reserveLamports: control.reserveLamports,
    unpaidHolderLamports: unpaidHolders.toString(),
    deployerRetainedLamports: obligations.deployerRetained,
    unspentPriorBuybackLamports: unspentPrior.toString(),
  });
  if (!covered.ok) return { ok: false, code: covered.code === "amount" ? "unreconciled" : "unfunded" };
  const authorised = authoriseBucketSpend({
    bucket: "buyback",
    creditedLamports: net,
    reserveLamports: "0",
    bucketSpentLamports: "0",
    amountLamports: buyback,
    cycleSpentLamports: "0",
    cycleCapLamports: control.cycleCapLamports,
    slippageBps: control.slippageBps,
    destination: parent.deployerAddress,
    allowedDestinations: [parent.deployerAddress],
    programs: [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, FEE_PROGRAM],
    allowedPrograms: [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, FEE_PROGRAM, parent.tokenProgram],
    suspended: control.suspended,
    walletLamports: wallet?.lamports ?? "0",
  });
  if (!authorised.ok) return { ok: false, code: authorised.code === "unfunded" ? "unfunded" : "spend" };
  const quoteLamports = market.graduated ? boundedBuyQuote(buyback, control.slippageBps) : buyback;
  const built = await buildCurveBuyback({
    parentMint: parent.mintAddress,
    deployer: parent.deployerAddress,
    tokenProgram: parent.tokenProgram,
    quoteLamports,
    minimumTokens: "1",
    slippageBps: control.slippageBps,
    graduated: market.graduated,
    pool: market.graduated ? market.pool : null,
    curve: market.graduated ? null : market.curve,
  });
  if (!built.ok) return { ok: false, code: built.code === "graduated_market" ? "market" : "program" };
  const blockhash = await input.chain.blockhash();
  const sent = await broadcast({
    secret,
    expectedAddress: input.expectedAddress,
    suspended: input.suspended,
    parent,
    control,
    intent: { key: buyKey, kind: "buyback", amount: buyback },
    transaction: { feePayer: parent.deployerAddress, recentBlockhash: blockhash, instructions: bare(built.instructions) },
    chain: input.chain,
    store: input.store,
    lookup,
  });
  if (!sent.ok) return sent;
  if (sent.observed.status === "failed") return { ok: true, stage: "collected", netLamports: net, tokenCredited: "0" };
  const tokens = reconcileBuyback({ status: "confirmed", quotedTokenAmount: "1", tokenDelta: sent.observed.tokenDelta });
  if (!tokens.ok) {
    await input.store.markIntent(parent.mintAddress, parent.scope, buyKey, "unreconciled", sent.signature);
    return { ok: true, stage: "collected", netLamports: net, tokenCredited: "0" };
  }
  const credited = await creditTokens(input.store, parent, key, tokens.credited);
  if (!credited.ok) return credited;
  return { ok: true, stage: "bought", netLamports: net, tokenCredited: tokens.credited };
}

async function creditTokens(store: RewardsStore, parent: RegisteredParent, windowKey: string, amount: string): Promise<CycleResult> {
  const rows = await store.snapshots(parent.mintAddress, parent.scope, windowKey);
  const total = rows.reduce((sum, row) => sum + BigInt(row.balance), BigInt(0));
  if (total <= BigInt(0)) return { ok: true, stage: "collected", netLamports: "0", tokenCredited: "0" };
  const shares = rows.map((row) => ({ owner: row.owner, tokenAmount: ((BigInt(amount) * BigInt(row.balance)) / total).toString() }));
  const saved = await store.creditSnapshotTokens(parent.mintAddress, parent.scope, windowKey, shares);
  if (saved !== "ok") return { ok: false, code: "unreconciled" };
  return { ok: true, stage: "bought", netLamports: "0", tokenCredited: amount };
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
  store: RewardsStore;
  chain: Chain;
}): Promise<{ ok: true; signature: string } | { ok: false; code: CycleCode | "duplicate" | "ownership" | "amount" }> {
  if (!rewardsExecutionEnabled({
    loopEnabled: input.loopEnabled ? "true" : "false",
    executionAuthorised: input.authorised ? "true" : "false",
    suspended: input.suspended,
  })) {
    return { ok: false, code: "inactive" };
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
    const received = BigInt(input.asset === "sol" ? observed.destinationDelta : observed.destinationTokenDelta);
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
  if (!wallet || BigInt(wallet.lamports) < BigInt(input.amount) + BigInt(control.reserveLamports)) return { ok: false, code: "unfunded" };
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
  const sent = await input.chain.submit(wire);
  const vaults = await readCreatorVaults(input.chain, parent.deployerAddress);
  const lookup: VaultLookup = {
    creator: parent.deployerAddress,
    solVault: vaults.ok ? vaults.solVault : parent.deployerAddress,
    wsolVault: vaults.ok ? vaults.wsolVault : parent.deployerAddress,
    parentMint: parent.mintAddress,
    destination: input.claimant,
  };
  if (sent === "uncertain") {
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "uncertain", signed.signature);
    return { ok: false, code: "uncertain" };
  }
  const observed = await input.chain.transaction(signed.signature, lookup);
  if (!observed || observed.status !== "confirmed") {
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, observed?.status === "failed" ? "failed" : "uncertain", signed.signature);
    return { ok: false, code: observed?.status === "failed" ? "failed" : "uncertain" };
  }
  const received = BigInt(input.asset === "sol" ? observed.destinationDelta : observed.destinationTokenDelta);
  if (received < BigInt(input.amount)) {
    await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "unreconciled", signed.signature);
    return { ok: false, code: "unreconciled" };
  }
  await input.store.markClaim(parent.mintAddress, parent.scope, input.idempotencyKey, "confirmed", signed.signature);
  return { ok: true, signature: signed.signature };
}
