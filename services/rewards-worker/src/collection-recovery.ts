import { planIncrementalAllocation } from "../../../lib/rewards/ledger.ts";
import { explainCreatorDelta, reconcileCreatorFee } from "../../../lib/rewards/reconcile.ts";
import { ammWsolVaultAddress, type Chain, type ObservedTransaction } from "./chain.ts";
import { TREST_REHEARSAL_MINT, type RewardsStore } from "./store.ts";

export const COLLECTION_RECOVERY_APPROVAL = "TREST-07J-COLLECTION-RECOVERY";
export const CONFIRMED_COLLECTION = {
  parentMint: TREST_REHEARSAL_MINT,
  scope: "test" as const,
  idempotencyKey: "collect-1792603200000",
  signature: "3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF",
  slot: "459711211",
  windowStartMs: 1792603200000,
  deployer: "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR",
  gross: "85145307",
  fee: "5000",
  net: "85140307",
  reserve: "5000000",
  holders: "24042092",
  buyback: "24042092",
  deployerRetained: "32056123",
  programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  instruction: "CollectCreatorFeeV2",
  accounts: [
    "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR",
    "6QmGiHeTkMrX41SdcurrSvU4LExysBYZmPcpR3HxTMHd",
    "A9iRd6QFkkFYUp5Ee9bDUao4kxz2rvXxMjK18YfiYo3S",
    "rtk1jAcsQb6t2D5b5QUgpjbF2LCVe5haW4WRU1bJcMd",
    "So11111111111111111111111111111111111111112",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "11111111111111111111111111111111",
    "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  ],
} as const;

const OPERATOR = /^[A-Za-z0-9_-]{1,80}$/;

export type CollectionRecoveryCode =
  | "approval"
  | "backing"
  | "duplicate"
  | "evidence"
  | "intent"
  | "operator"
  | "rehearsal"
  | "snapshot"
  | "suspended";

export function historicalHolderSnapshot(): { ok: false; reason: "historical_balances_unavailable" } {
  return { ok: false, reason: "historical_balances_unavailable" };
}

export function plannedCollectionAllocation(): { ok: true; withheld: string; base: string; holders: string; buyback: string; deployer: string } | { ok: false; code: "amount" } {
  const planned = planIncrementalAllocation({
    grossLamports: CONFIRMED_COLLECTION.net,
    reserveLamports: CONFIRMED_COLLECTION.reserve,
    reserveWithheldLamports: "0",
  });
  if (!planned.ok) return planned;
  if (
    planned.withheld !== CONFIRMED_COLLECTION.reserve
    || planned.holders !== CONFIRMED_COLLECTION.holders
    || planned.buyback !== CONFIRMED_COLLECTION.buyback
    || planned.deployer !== CONFIRMED_COLLECTION.deployerRetained
  ) return { ok: false, code: "amount" };
  return planned;
}

export function buybackRecoveryAuthorisation(): { ok: false; reason: "separate_financial_authorisation_required"; budgetLamports: string } {
  return { ok: false, reason: "separate_financial_authorisation_required", budgetLamports: CONFIRMED_COLLECTION.buyback };
}

function matchesObservation(observed: ObservedTransaction): boolean {
  return observed.status === "confirmed"
    && observed.slot === CONFIRMED_COLLECTION.slot
    && observed.feeLamports === CONFIRMED_COLLECTION.fee
    && observed.feePayer === CONFIRMED_COLLECTION.deployer
    && observed.nativeVaultOut === CONFIRMED_COLLECTION.gross
    && observed.creatorDelta === CONFIRMED_COLLECTION.net
    && observed.wsolTokenOut === "0"
    && observed.wsolClosedLamports === "0";
}

export async function recoverConfirmedCollection(input: {
  authorised: boolean;
  approval: string;
  operator: string;
  reason: string;
  store: RewardsStore;
  chain: Chain;
}): Promise<{ ok: true; duplicate: boolean; net: string } | { ok: false; code: CollectionRecoveryCode }> {
  if (!input.authorised || input.approval !== COLLECTION_RECOVERY_APPROVAL) return { ok: false, code: "approval" };
  if (!OPERATOR.test(input.operator)) return { ok: false, code: "operator" };
  const reason = input.reason.trim();
  if (reason.length === 0 || input.reason.length > 240) return { ok: false, code: "operator" };
  const control = await input.store.control(CONFIRMED_COLLECTION.parentMint, CONFIRMED_COLLECTION.scope);
  if (!control?.suspended) return { ok: false, code: "suspended" };
  const rehearsal = await input.store.rehearsalState(CONFIRMED_COLLECTION.parentMint, CONFIRMED_COLLECTION.scope);
  if (!rehearsal || rehearsal.status !== "stopped" || !rehearsal.windowStartsMs.includes(CONFIRMED_COLLECTION.windowStartMs)) {
    return { ok: false, code: "rehearsal" };
  }
  const intents = await input.store.intents(CONFIRMED_COLLECTION.parentMint, CONFIRMED_COLLECTION.scope);
  const intent = intents.find((row) => row.idempotencyKey === CONFIRMED_COLLECTION.idempotencyKey);
  if (!intent || intent.signature !== CONFIRMED_COLLECTION.signature || intent.kind !== "collect") return { ok: false, code: "intent" };
  const receipts = await input.store.receipts(CONFIRMED_COLLECTION.parentMint, CONFIRMED_COLLECTION.scope);
  const audits = await input.store.collectionRecoveries(CONFIRMED_COLLECTION.parentMint, CONFIRMED_COLLECTION.scope);
  const receipt = receipts.find((row) => row.signature === CONFIRMED_COLLECTION.signature);
  const audit = audits.find((row) => row.signature === CONFIRMED_COLLECTION.signature);
  if (intent.status === "confirmed" && receipt && audit) return { ok: true, duplicate: true, net: CONFIRMED_COLLECTION.net };
  if (intent.status !== "uncertain") return { ok: false, code: "intent" };
  if (historicalHolderSnapshot().reason !== "historical_balances_unavailable") return { ok: false, code: "snapshot" };
  if (buybackRecoveryAuthorisation().ok !== false) return { ok: false, code: "evidence" };
  const planned = plannedCollectionAllocation();
  if (!planned.ok) return { ok: false, code: "evidence" };
  const status = input.chain.signatureStatus ? await input.chain.signatureStatus(CONFIRMED_COLLECTION.signature) : "unknown";
  if (status !== "finalized") return { ok: false, code: "evidence" };
  const wsolVault = ammWsolVaultAddress(CONFIRMED_COLLECTION.deployer);
  if (!wsolVault) return { ok: false, code: "evidence" };
  const observed = await input.chain.transaction(CONFIRMED_COLLECTION.signature, {
    creator: CONFIRMED_COLLECTION.deployer,
    solVault: "A9iRd6QFkkFYUp5Ee9bDUao4kxz2rvXxMjK18YfiYo3S",
    wsolVault,
    parentMint: CONFIRMED_COLLECTION.parentMint,
    destination: CONFIRMED_COLLECTION.deployer,
  });
  if (!observed || !matchesObservation(observed)) return { ok: false, code: "evidence" };
  const explained = explainCreatorDelta({
    creatorDeltaLamports: observed.creatorDelta,
    nativeVaultOutLamports: observed.nativeVaultOut,
    wsolClosedLamports: observed.wsolClosedLamports,
    networkFeeLamports: observed.feeLamports,
    deployerPaidFee: observed.feePayer === CONFIRMED_COLLECTION.deployer,
  });
  if (!explained.ok || explained.unrelatedDepositLamports !== "0") return { ok: false, code: "evidence" };
  const credited = reconcileCreatorFee({
    status: "confirmed",
    signature: CONFIRMED_COLLECTION.signature,
    slot: observed.slot,
    parentMint: CONFIRMED_COLLECTION.parentMint,
    scope: CONFIRMED_COLLECTION.scope,
    creator: CONFIRMED_COLLECTION.deployer,
    feePayer: observed.feePayer,
    vaultOutLamports: observed.nativeVaultOut,
    creatorDeltaLamports: observed.creatorDelta,
    networkFeeLamports: observed.feeLamports,
    unrelatedDepositLamports: "0",
    existing: receipts,
  });
  if (!credited.ok || credited.net !== CONFIRMED_COLLECTION.net) return { ok: false, code: "evidence" };
  const wallet = await input.chain.account(CONFIRMED_COLLECTION.deployer);
  if (!wallet || BigInt(wallet.lamports) < BigInt(CONFIRMED_COLLECTION.net)) return { ok: false, code: "backing" };
  const identity = input.chain.collectionIdentity ? await input.chain.collectionIdentity(CONFIRMED_COLLECTION.signature) : null;
  const accountsMatch = identity?.accounts.length === CONFIRMED_COLLECTION.accounts.length
    && identity.accounts.every((account, index) => account === CONFIRMED_COLLECTION.accounts[index]);
  if (!identity || identity.instruction !== CONFIRMED_COLLECTION.instruction || identity.programId !== CONFIRMED_COLLECTION.programId || !accountsMatch) {
    return { ok: false, code: "evidence" };
  }
  const committed = await input.store.commitCollectionRecovery({
    parentMint: CONFIRMED_COLLECTION.parentMint,
    scope: CONFIRMED_COLLECTION.scope,
    idempotencyKey: CONFIRMED_COLLECTION.idempotencyKey,
    signature: CONFIRMED_COLLECTION.signature,
    priorStatus: "uncertain",
    approval: COLLECTION_RECOVERY_APPROVAL,
    operator: input.operator,
    reason,
    grossLamports: CONFIRMED_COLLECTION.gross,
    feeLamports: CONFIRMED_COLLECTION.fee,
    netLamports: CONFIRMED_COLLECTION.net,
    reserveLamports: planned.withheld,
    holderLamports: planned.holders,
    buybackLamports: planned.buyback,
    deployerLamports: planned.deployer,
    snapshotStatus: "historical_unavailable",
    gross: credited.gross,
    fee: credited.fee,
    native: credited.native,
    wsolConverted: credited.wsolConverted,
    rentExcluded: credited.rentExcluded,
    slot: observed.slot,
    amountLamports: credited.net,
  });
  if (committed === "duplicate") return { ok: true, duplicate: true, net: CONFIRMED_COLLECTION.net };
  if (committed !== "ok") return { ok: false, code: committed === "order" ? "intent" : "evidence" };
  const after = await input.store.rehearsalState(CONFIRMED_COLLECTION.parentMint, CONFIRMED_COLLECTION.scope);
  if (!after || after.status !== "stopped") return { ok: false, code: "rehearsal" };
  return { ok: true, duplicate: false, net: credited.net };
}
