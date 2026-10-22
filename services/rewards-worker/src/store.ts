import { allocateWindow, windowKey } from "../../../lib/rewards/cycle.ts";
import { legacyCollectionRetired, matchesLegacyCollection } from "./legacy-recovery.ts";
import type { ExecutionIntent, IntentStatus } from "../../../lib/rewards/cycle.ts";
import { planIncrementalAllocation, WINDOW_MS, type FeeReceipt, type RewardScope } from "../../../lib/rewards/ledger.ts";

export const TREST_REHEARSAL_MINT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";

export type RehearsalAdmission =
  | { ok: true; admission: "execute" | "replay" }
  | { ok: false; code: "absent" | "schedule" | "stopped" | "closed" | "claimed" };

export type RehearsalState = {
  status: "open" | "stopped" | "closed";
  windowStartsMs: number[];
  processed: { windowStartMs: number; outcome: "claimed" | "ok" | "stopped" }[];
  blocksSideWork: boolean;
};

export type RehearsalRegistration = {
  parentMint: string;
  scope: RewardScope;
  windowStartsMs: readonly number[];
  nowMs?: number;
  requireUpcoming?: boolean;
  blockSideWork?: boolean;
  generation?: number;
};

export function validRehearsalStarts(starts: readonly number[]): [number, number, number] | null {
  if (starts.length !== 3) return null;
  const [first, second, third] = starts;
  if (first === undefined || second === undefined || third === undefined) return null;
  if (![first, second, third].every((value) => Number.isInteger(value) && value > 0 && value % WINDOW_MS === 0)) return null;
  if (second !== first + WINDOW_MS || third !== second + WINDOW_MS) return null;
  return [first, second, third];
}

export type RegisteredParent = {
  id: string;
  scope: RewardScope;
  symbol: "TREST" | "SDK";
  mintAddress: string;
  deployerAddress: string;
  feeRecipientAddress: string;
  feeMode: "single_recipient" | "fee_sharing" | "holder_rewards" | "unknown";
  tokenProgram: string;
  decimals: number;
  graduated: boolean;
  quoteMintAddress: string;
  eligible: boolean;
};

export type RewardControl = {
  suspended: boolean;
  reserveLamports: string;
  cycleCapLamports: string;
  slippageBps: number;
};

export type StoredIntent = ExecutionIntent & {
  amountLamports: string | null;
  tokenAmount: string | null;
  messageSha256: string | null;
  recentBlockhash: string | null;
  submissionCode: string | null;
  submissionDetail: string | null;
  createdAtMs: string;
};

export type LegacyEvidence = {
  signatureState: "absent";
  transaction: "absent";
  currentSlot: string;
  submissionSlot: string;
  slotsElapsed: string;
  blockhashSlots: "150";
  createdAtMs: string;
  deployerLamports: string;
  vaultLamports: string;
};

export type LegacyRecovery = {
  id: string;
  parentMint: string;
  scope: RewardScope;
  idempotencyKey: string;
  signature: string;
  priorStatus: "uncertain";
  operatorId: string;
  approval: string;
  reason: string;
  evidence: LegacyEvidence;
  createdAtMs: string;
};

export type CollectionRecovery = {
  id: string;
  parentMint: string;
  scope: RewardScope;
  idempotencyKey: string;
  signature: string;
  priorStatus: "uncertain";
  approval: string;
  operator: string;
  reason: string;
  grossLamports: string;
  feeLamports: string;
  netLamports: string;
  reserveLamports: string;
  holderLamports: string;
  buybackLamports: string;
  deployerLamports: string;
  snapshotStatus: "historical_unavailable";
  createdAtMs: string;
};

export type SubmissionNote = {
  recentBlockhash: string | null;
  submissionCode: string | null;
  submissionDetail: string | null;
};

export type StoredSnapshot = {
  owner: string;
  balance: string;
  solLamports: string;
  tokenAmount: string;
  cutoffSlot: string;
};

export type StoredClaim = {
  claimant: string;
  asset: "sol" | "trest";
  amount: string;
  idempotencyKey: string;
  status: IntentStatus;
  signature: string | null;
  scope: RewardScope;
  parentMint: string;
  proofHash: string;
};

export type SolObligations = {
  holderSol: string;
  confirmedHolderSol: string;
  deployerRetained: string;
  buybackSol: string;
  confirmedBuybackSol: string;
  deferredHolderLamports: string;
  deferredBuybackLamports: string;
  deferredDeployerLamports: string;
};

export type WindowAllocation =
  | { ok: true; state: "empty" }
  | { ok: true; state: "reserved"; withheld: string }
  | { ok: true; state: "allocated" | "duplicate"; base: string; holders: string; buyback: string; deployer: string; withheld: string }
  | { ok: false; code: "amount" | "duplicate" | "window" };

export type RewardsStore = {
  parent(scope: RewardScope): Promise<RegisteredParent | null>;
  control(parentMint: string, scope: RewardScope): Promise<RewardControl | null>;
  solObligations(parentMint: string, scope: RewardScope): Promise<SolObligations>;
  allocateUnallocated(input: {
    parentMint: string;
    scope: RewardScope;
    windowKey: string;
    reserveLamports: string;
  }): Promise<WindowAllocation>;
  intents(parentMint: string, scope: RewardScope): Promise<StoredIntent[]>;
  recordIntent(intent: Omit<StoredIntent, "status" | "signature" | "recentBlockhash" | "submissionCode" | "submissionDetail" | "createdAtMs"> & { amountLamports: string | null; recentBlockhash?: string | null; createdAtMs?: string }): Promise<"ok" | "duplicate">;
  markIntent(parentMint: string, scope: RewardScope, idempotencyKey: string, status: IntentStatus, signature: string | null): Promise<"ok" | "order" | "duplicate">;
  recordSubmission(parentMint: string, scope: RewardScope, idempotencyKey: string, note: SubmissionNote): Promise<"ok" | "order">;
  legacyRecoveries(parentMint: string, scope: RewardScope): Promise<LegacyRecovery[]>;
  saveLegacyRecovery(input: Omit<LegacyRecovery, "id" | "createdAtMs">): Promise<{ ok: true; id: string } | { ok: false; code: "duplicate" | "rejected" }>;
  collectionRecoveries(parentMint: string, scope: RewardScope): Promise<CollectionRecovery[]>;
  saveCollectionRecovery(input: Omit<CollectionRecovery, "id" | "createdAtMs">): Promise<{ ok: true; id: string } | { ok: false; code: "duplicate" | "rejected" }>;
  commitCollectionRecovery(input: Omit<CollectionRecovery, "id" | "createdAtMs"> & {
    gross: string;
    fee: string;
    native: string;
    wsolConverted: string;
    rentExcluded: string;
    slot: string;
    amountLamports: string;
  }): Promise<"ok" | "duplicate" | "rejected" | "order">;
  receipts(parentMint: string, scope: RewardScope): Promise<FeeReceipt[]>;
  saveReceipt(receipt: FeeReceipt & { gross: string; fee: string; native: string; wsolConverted: string; rentExcluded: string }): Promise<"ok" | "duplicate">;
  windows(parentMint: string, scope: RewardScope): Promise<{ windowKey: string; collected: string; holders: string; buyback: string; deployer: string }[]>;
  saveWindow(input: {
    parentMint: string;
    scope: RewardScope;
    windowKey: string;
    collected: string;
    holders: string;
    buyback: string;
    deployer: string;
  }): Promise<"ok" | "duplicate">;
  snapshots(parentMint: string, scope: RewardScope, windowKey: string): Promise<StoredSnapshot[]>;
  saveSnapshots(parentMint: string, scope: RewardScope, windowKey: string, rows: StoredSnapshot[]): Promise<"ok" | "duplicate">;
  creditSnapshotTokens(parentMint: string, scope: RewardScope, windowKey: string, rows: { owner: string; tokenAmount: string }[]): Promise<"ok" | "missing">;
  claims(parentMint: string, scope: RewardScope): Promise<StoredClaim[]>;
  saveClaim(claim: StoredClaim): Promise<"ok" | "duplicate" | "uncertain" | "amount">;
  markClaim(parentMint: string, scope: RewardScope, idempotencyKey: string, status: IntentStatus, signature: string | null): Promise<"ok" | "order">;
  tryLock(parentMint: string, scope: RewardScope, holder: string, nowMs: number): Promise<"ok" | "locked">;
  unlock(parentMint: string, scope: RewardScope, holder: string): Promise<void>;
  registerRehearsal(input: RehearsalRegistration): Promise<"ok" | "rejected" | "duplicate">;
  claimRehearsalWindow(input: { parentMint: string; scope: RewardScope; windowStartMs: number }): Promise<RehearsalAdmission>;
  finishRehearsalWindow(input: { parentMint: string; scope: RewardScope; windowStartMs: number; outcome: "ok" | "stopped" }): Promise<"ok" | "order">;
  rehearsalState(parentMint: string, scope: RewardScope): Promise<RehearsalState | null>;
  rehearsalBlocksSideWork(parentMint: string, scope: RewardScope): Promise<boolean>;
};

const LEASE_MS = 5 * 60 * 1000;

export type RehearsalGenerationDecision = "ok" | "duplicate" | "overlap" | "unresolved" | "rejected";

export function admitNextRehearsal(input: {
  existing: readonly { generation: number; status: "open" | "stopped" | "closed"; starts: readonly number[] }[];
  generation: number;
  starts: readonly number[];
  unresolvedIntents: number;
  unallocatedReceipts: number;
  claimableLiabilities: number;
}): RehearsalGenerationDecision {
  if (!validRehearsalStarts(input.starts)) return "rejected";
  if (!Number.isInteger(input.generation) || input.generation < 1 || input.generation > 100) return "rejected";
  if (input.existing.some((row) => row.status === "open")) return "overlap";
  if (input.existing.some((row) => row.generation === input.generation)) return "duplicate";
  const max = input.existing.reduce((highest, row) => Math.max(highest, row.generation), 0);
  if (input.generation !== max + 1) return "rejected";
  if (input.generation > 1) {
    if (input.existing.some((row) => row.starts.some((start) => input.starts.includes(start)))) return "overlap";
    if (input.unresolvedIntents > 0 || input.unallocatedReceipts > 0 || input.claimableLiabilities > 0) return "unresolved";
  }
  return "ok";
}

export function memoryStore(seed: {
  parent: RegisteredParent;
  control: RewardControl;
  rehearsal?: { windowStartsMs: readonly number[]; blockSideWork?: boolean };
}): RewardsStore {
  const intents: StoredIntent[] = [];
  const legacyRecoveries: LegacyRecovery[] = [];
  const collectionRecoveries: CollectionRecovery[] = [];
  const receipts: Array<FeeReceipt & { gross: string; fee: string; native: string; wsolConverted: string; rentExcluded: string; allocated: boolean; reserveWithheld: string; allocationDeferred: boolean }> = [];
  const windows: Array<{ parentMint: string; scope: RewardScope; windowKey: string; collected: string; holders: string; buyback: string; deployer: string }> = [];
  const snapshots: Array<StoredSnapshot & { parentMint: string; scope: RewardScope; windowKey: string }> = [];
  const claims: StoredClaim[] = [];
  let lock: { parentMint: string; scope: RewardScope; holder: string; expiresAt: number } | null = null;
  type MemoryRehearsal = {
    generation: number;
    status: "open" | "stopped" | "closed";
    starts: [number, number, number];
    windows: Map<number, "claimed" | "ok" | "stopped">;
    blockSideWork: boolean;
  };
  const rehearsals: MemoryRehearsal[] = [];
  const currentRehearsal = (): MemoryRehearsal | null => rehearsals.find((row) => row.status === "open") ?? rehearsals[rehearsals.length - 1] ?? null;
  if (seed.rehearsal) {
    const starts = validRehearsalStarts(seed.rehearsal.windowStartsMs);
    if (!starts || seed.parent.scope !== "test") throw new Error("rehearsal");
    rehearsals.push({
      generation: 1,
      status: "open",
      starts,
      windows: new Map(),
      blockSideWork: seed.rehearsal.blockSideWork ?? true,
    });
  }
  const suspendControl = () => {
    seed.control.suspended = true;
  };
  let tail = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T> | T): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    async parent(scope) {
      return seed.parent.scope === scope ? seed.parent : null;
    },
    async control(parentMint, scope) {
      if (seed.parent.mintAddress !== parentMint || seed.parent.scope !== scope) return null;
      return seed.control;
    },
    async solObligations(parentMint, scope) {
      const rows = windows.filter((row) => row.parentMint === parentMint && row.scope === scope);
      const sum = (pick: (row: (typeof rows)[number]) => string) => rows.reduce((total, row) => total + BigInt(pick(row)), BigInt(0)).toString();
      const confirmedHolder = claims
        .filter((claim) => claim.parentMint === parentMint && claim.scope === scope && claim.asset === "sol" && claim.status === "confirmed")
        .reduce((total, claim) => total + BigInt(claim.amount), BigInt(0));
      const confirmedBuyback = intents
        .filter((intent) => intent.parentMint === parentMint && intent.scope === scope && intent.kind === "buyback" && intent.status === "confirmed")
        .reduce((total, intent) => total + BigInt(intent.amountLamports ?? "0"), BigInt(0));
      const deferredReceipts = receipts.filter((receipt) => receipt.parentMint === parentMint && receipt.scope === scope && receipt.allocationDeferred && !receipt.allocated);
      const deferredFor = (pick: (row: (typeof collectionRecoveries)[number]) => string) => deferredReceipts.reduce((total, receipt) => {
        const audit = collectionRecoveries.find((row) => row.signature === receipt.signature);
        return total + BigInt(audit ? pick(audit) : "0");
      }, BigInt(0));
      const recordedBuyback = BigInt(sum((row) => row.buyback));
      const excessBuyback = confirmedBuyback > recordedBuyback ? confirmedBuyback - recordedBuyback : BigInt(0);
      const deferredBuyback = deferredFor((row) => row.buybackLamports);
      return {
        holderSol: sum((row) => row.holders),
        confirmedHolderSol: confirmedHolder.toString(),
        deployerRetained: sum((row) => row.deployer),
        buybackSol: sum((row) => row.buyback),
        confirmedBuybackSol: confirmedBuyback.toString(),
        deferredHolderLamports: deferredFor((row) => row.holderLamports).toString(),
        deferredBuybackLamports: (deferredBuyback > excessBuyback ? deferredBuyback - excessBuyback : BigInt(0)).toString(),
        deferredDeployerLamports: deferredFor((row) => row.deployerLamports).toString(),
      };
    },
    async allocateUnallocated(input) {
      return exclusive(() => {
        const startMs = Number(input.windowKey.split(":").at(-1));
        if (!Number.isInteger(startMs) || windowKey(input.parentMint, input.scope, startMs + 1) !== input.windowKey) {
          return { ok: false, code: "window" };
        }
        const existing = windows.find((row) => row.parentMint === input.parentMint && row.scope === input.scope && row.windowKey === input.windowKey);
        if (existing) {
          return { ok: true, state: "duplicate", base: existing.collected, holders: existing.holders, buyback: existing.buyback, deployer: existing.deployer, withheld: "0" };
        }
        const open = receipts.filter((receipt) => receipt.parentMint === input.parentMint && receipt.scope === input.scope && !receipt.allocated && !receipt.allocationDeferred);
        if (open.length === 0) return { ok: true, state: "empty" };
        const allocatedSignatures = receipts.filter((receipt) => receipt.allocated).map((receipt) => receipt.signature);
        const guard = allocateWindow({
          parentMint: input.parentMint,
          scope: input.scope,
          timestampMs: startMs + 1,
          netLamports: open.reduce((total, receipt) => total + BigInt(receipt.amountLamports), BigInt(0)).toString(),
          reserveLamports: "0",
          receiptSignatures: open.map((receipt) => receipt.signature),
          allocatedSignatures,
          existingWindowKeys: [],
        });
        if (!guard.ok) return { ok: false, code: "duplicate" };
        const withheldAlready = receipts
          .filter((receipt) => receipt.parentMint === input.parentMint && receipt.scope === input.scope && receipt.allocated)
          .reduce((total, receipt) => total + BigInt(receipt.reserveWithheld), BigInt(0));
        const planned = planIncrementalAllocation({
          grossLamports: open.reduce((total, receipt) => total + BigInt(receipt.amountLamports), BigInt(0)).toString(),
          reserveLamports: input.reserveLamports,
          reserveWithheldLamports: withheldAlready.toString(),
        });
        if (!planned.ok) return { ok: false, code: "amount" };
        let remaining = BigInt(planned.withheld);
        const shares = [...open]
          .sort((left, right) => (left.signature < right.signature ? -1 : 1))
          .map((receipt) => {
            const amount = BigInt(receipt.amountLamports);
            const take = remaining > amount ? amount : remaining;
            remaining -= take;
            return { receipt, withheld: take.toString() };
          });
        if (remaining !== BigInt(0)) return { ok: false, code: "amount" };
        for (const share of shares) {
          share.receipt.allocated = true;
          share.receipt.reserveWithheld = share.withheld;
        }
        if (planned.base === "0") return { ok: true, state: "reserved", withheld: planned.withheld };
        windows.push({
          parentMint: input.parentMint,
          scope: input.scope,
          windowKey: input.windowKey,
          collected: planned.base,
          holders: planned.holders,
          buyback: planned.buyback,
          deployer: planned.deployer,
        });
        return { ok: true, state: "allocated", base: planned.base, holders: planned.holders, buyback: planned.buyback, deployer: planned.deployer, withheld: planned.withheld };
      });
    },
    async intents(parentMint, scope) {
      return intents.filter((intent) => intent.parentMint === parentMint && intent.scope === scope);
    },
    async recordIntent(intent) {
      return exclusive(() => {
        if (intents.some((row) => row.parentMint === intent.parentMint && row.scope === intent.scope && row.idempotencyKey === intent.idempotencyKey)) {
          return "duplicate";
        }
        intents.push({
          ...intent,
          status: "recorded",
          signature: null,
          recentBlockhash: intent.recentBlockhash ?? null,
          submissionCode: null,
          submissionDetail: null,
          createdAtMs: intent.createdAtMs ?? Date.now().toString(),
        });
        return "ok";
      });
    },
    async markIntent(parentMint, scope, idempotencyKey, status, signature) {
      return exclusive(() => {
        const current = intents.find((intent) => intent.parentMint === parentMint && intent.scope === scope && intent.idempotencyKey === idempotencyKey);
        if (!current) return "order";
        if (status === "recorded") return "order";
        if (current.status === "recorded" && (!signature || status !== "submitted")) return "order";
        if (current.status === "unreconciled" && status !== "confirmed" && status !== "failed") return "order";
        if (current.status !== "recorded" && current.status !== "submitted" && current.status !== "uncertain" && current.status !== "unreconciled") return "order";
        if (signature && intents.some((intent) => intent.signature === signature && intent.idempotencyKey !== idempotencyKey)) return "duplicate";
        current.status = status;
        current.signature = signature ?? current.signature;
        return "ok";
      });
    },
    async legacyRecoveries(parentMint, scope) {
      return legacyRecoveries.filter((row) => row.parentMint === parentMint && row.scope === scope);
    },
    async saveLegacyRecovery(input) {
      return exclusive(() => {
        if (!matchesLegacyCollection(input) || input.priorStatus !== "uncertain" || input.approval !== "TREST-07F-LEGACY-RECOVERY") return { ok: false, code: "rejected" };
        if (legacyRecoveries.some((row) => row.idempotencyKey === input.idempotencyKey || row.signature === input.signature)) return { ok: false, code: "duplicate" };
        const id = `recovery-${legacyRecoveries.length + 1}`;
        legacyRecoveries.push({ ...input, id, createdAtMs: Date.now().toString() });
        return { ok: true, id };
      });
    },
    async collectionRecoveries(parentMint, scope) {
      return collectionRecoveries.filter((row) => row.parentMint === parentMint && row.scope === scope);
    },
    async saveCollectionRecovery(input) {
      return exclusive(() => {
        if (input.priorStatus !== "uncertain" || input.snapshotStatus !== "historical_unavailable" || input.approval !== "TREST-07J-COLLECTION-RECOVERY") {
          return { ok: false, code: "rejected" };
        }
        if (collectionRecoveries.some((row) => row.signature === input.signature || row.idempotencyKey === input.idempotencyKey)) {
          return { ok: false, code: "duplicate" };
        }
        const id = `collection-recovery-${collectionRecoveries.length + 1}`;
        collectionRecoveries.push({ ...input, id, createdAtMs: Date.now().toString() });
        return { ok: true, id };
      });
    },
    async commitCollectionRecovery(input) {
      return exclusive(() => {
        if (input.priorStatus !== "uncertain" || input.snapshotStatus !== "historical_unavailable" || input.approval !== "TREST-07J-COLLECTION-RECOVERY") return "rejected";
        const intent = intents.find((row) => row.parentMint === input.parentMint && row.scope === input.scope && row.idempotencyKey === input.idempotencyKey);
        const receipt = receipts.find((row) => row.signature === input.signature);
        const audit = collectionRecoveries.find((row) => row.signature === input.signature);
        if (intent?.status === "confirmed" && receipt && audit) return "duplicate";
        if (!intent || intent.status !== "uncertain" || intent.signature !== input.signature) return "order";
        if (receipt || audit) return "order";
        collectionRecoveries.push({
          id: `collection-recovery-${collectionRecoveries.length + 1}`,
          parentMint: input.parentMint,
          scope: input.scope,
          idempotencyKey: input.idempotencyKey,
          signature: input.signature,
          priorStatus: input.priorStatus,
          approval: input.approval,
          operator: input.operator,
          reason: input.reason,
          grossLamports: input.grossLamports,
          feeLamports: input.feeLamports,
          netLamports: input.netLamports,
          reserveLamports: input.reserveLamports,
          holderLamports: input.holderLamports,
          buybackLamports: input.buybackLamports,
          deployerLamports: input.deployerLamports,
          snapshotStatus: input.snapshotStatus,
          createdAtMs: Date.now().toString(),
        });
        receipts.push({
          signature: input.signature,
          parentMint: input.parentMint,
          scope: input.scope,
          amountLamports: input.amountLamports,
          slot: input.slot,
          confirmed: true,
          source: "creator_vault",
          gross: input.gross,
          fee: input.fee,
          native: input.native,
          wsolConverted: input.wsolConverted,
          rentExcluded: input.rentExcluded,
          allocated: false,
          reserveWithheld: "0",
          allocationDeferred: true,
        });
        intent.status = "confirmed";
        return "ok";
      });
    },
    async recordSubmission(parentMint, scope, idempotencyKey, note) {
      return exclusive(() => {
        const current = intents.find((intent) => intent.parentMint === parentMint && intent.scope === scope && intent.idempotencyKey === idempotencyKey);
        if (!current) return "order";
        if (note.recentBlockhash) current.recentBlockhash = note.recentBlockhash;
        if (note.submissionCode) current.submissionCode = note.submissionCode.slice(0, 40);
        if (note.submissionDetail) current.submissionDetail = note.submissionDetail.slice(0, 240);
        return "ok";
      });
    },
    async receipts(parentMint, scope) {
      return receipts.filter((receipt) => receipt.parentMint === parentMint && receipt.scope === scope);
    },
    async saveReceipt(receipt) {
      return exclusive(() => {
        if (receipts.some((row) => row.signature === receipt.signature)) return "duplicate";
        receipts.push({ ...receipt, allocated: false, reserveWithheld: "0", allocationDeferred: false });
        return "ok";
      });
    },
    async windows(parentMint, scope) {
      return windows.filter((row) => row.parentMint === parentMint && row.scope === scope);
    },
    async saveWindow(input) {
      return exclusive(() => {
        if (windows.some((row) => row.windowKey === input.windowKey)) return "duplicate";
        windows.push(input);
        return "ok";
      });
    },
    async snapshots(parentMint, scope, windowKey) {
      return snapshots.filter((row) => row.parentMint === parentMint && row.scope === scope && row.windowKey === windowKey);
    },
    async saveSnapshots(parentMint, scope, windowKey, rows) {
      return exclusive(() => {
        if (snapshots.some((row) => row.parentMint === parentMint && row.scope === scope && row.windowKey === windowKey)) return "duplicate";
        snapshots.push(...rows.map((row) => ({ ...row, parentMint, scope, windowKey })));
        return "ok";
      });
    },
    async creditSnapshotTokens(parentMint, scope, windowKey, rows) {
      return exclusive(() => {
        const existing = snapshots.filter((row) => row.parentMint === parentMint && row.scope === scope && row.windowKey === windowKey);
        if (existing.length === 0) return "missing";
        for (const row of rows) {
          const snapshot = existing.find((item) => item.owner === row.owner);
          if (!snapshot) return "missing";
          snapshot.tokenAmount = row.tokenAmount;
        }
        return "ok";
      });
    },
    async claims(parentMint, scope) {
      return claims.filter((claim) => claim.parentMint === parentMint && claim.scope === scope);
    },
    async saveClaim(claim) {
      return exclusive(() => {
        if (claims.some((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.idempotencyKey === claim.idempotencyKey)) {
          return "duplicate";
        }
        if (claims.some((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.claimant === claim.claimant && row.asset === claim.asset && (row.status === "uncertain" || row.status === "unreconciled" || row.status === "submitted"))) {
          return "uncertain";
        }
        const entitlement = snapshots
          .filter((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.owner === claim.claimant)
          .reduce((sum, row) => sum + BigInt(claim.asset === "sol" ? row.solLamports : row.tokenAmount), BigInt(0));
        const already = claims
          .filter((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.claimant === claim.claimant && row.asset === claim.asset && row.status !== "failed")
          .reduce((sum, row) => sum + BigInt(row.amount), BigInt(0));
        if (already + BigInt(claim.amount) > entitlement) return "amount";
        claims.push(claim);
        return "ok";
      });
    },
    async markClaim(parentMint, scope, idempotencyKey, status, signature) {
      return exclusive(() => {
        const claim = claims.find((row) => row.parentMint === parentMint && row.scope === scope && row.idempotencyKey === idempotencyKey);
        if (!claim || (claim.status !== "recorded" && claim.status !== "submitted" && claim.status !== "uncertain" && claim.status !== "unreconciled")) return "order";
        claim.status = status;
        claim.signature = signature ?? claim.signature;
        return "ok";
      });
    },
    async tryLock(parentMint, scope, holder, nowMs) {
      return exclusive(() => {
        if (lock && lock.expiresAt > nowMs && (lock.parentMint !== parentMint || lock.scope !== scope || lock.holder !== holder)) {
          return "locked";
        }
        lock = { parentMint, scope, holder, expiresAt: nowMs + LEASE_MS };
        return "ok";
      });
    },
    async unlock(parentMint, scope, holder) {
      await exclusive(() => {
        if (lock && lock.parentMint === parentMint && lock.scope === scope && lock.holder === holder) lock = null;
      });
    },
    async registerRehearsal(input) {
      return exclusive(() => {
        const starts = validRehearsalStarts(input.windowStartsMs);
        if (!starts || input.scope !== "test" || input.parentMint !== seed.parent.mintAddress) return "rejected";
        if (input.requireUpcoming && (!Number.isInteger(input.nowMs) || starts[0] <= (input.nowMs ?? 0))) return "rejected";
        const generation = input.generation ?? 1;
        const unresolvedIntents = intents.filter((intent) =>
          intent.parentMint === input.parentMint
          && intent.scope === input.scope
          && (intent.status === "submitted" || intent.status === "uncertain" || intent.status === "unreconciled")
          && !legacyCollectionRetired(intent, legacyRecoveries)
        ).length;
        const decision = admitNextRehearsal({
          existing: rehearsals,
          generation,
          starts,
          unresolvedIntents,
          unallocatedReceipts: receipts.filter((receipt) => receipt.parentMint === input.parentMint && receipt.scope === input.scope && !receipt.allocated).length,
          claimableLiabilities: windows.filter((row) => row.parentMint === input.parentMint && row.scope === input.scope).length,
        });
        if (decision === "duplicate") return "duplicate";
        if (decision !== "ok") return "rejected";
        rehearsals.push({
          generation,
          status: "open",
          starts,
          windows: new Map(),
          blockSideWork: input.blockSideWork ?? true,
        });
        return "ok";
      });
    },
    async claimRehearsalWindow(input) {
      return exclusive(() => {
        const rehearsal = currentRehearsal();
        if (!rehearsal || input.parentMint !== seed.parent.mintAddress || input.scope !== seed.parent.scope) {
          return { ok: false, code: "absent" };
        }
        if (rehearsal.status === "stopped") return { ok: false, code: "stopped" };
        if (rehearsal.status === "closed") return { ok: false, code: "closed" };
        if (!rehearsal.starts.includes(input.windowStartMs)) return { ok: false, code: "schedule" };
        const existing = rehearsal.windows.get(input.windowStartMs);
        if (existing === "ok") return { ok: true, admission: "replay" };
        if (existing === "stopped") {
          rehearsal.status = "stopped";
          suspendControl();
          return { ok: false, code: "stopped" };
        }
        if (existing === "claimed") return { ok: false, code: "claimed" };
        rehearsal.windows.set(input.windowStartMs, "claimed");
        return { ok: true, admission: "execute" };
      });
    },
    async finishRehearsalWindow(input) {
      return exclusive(() => {
        const rehearsal = currentRehearsal();
        if (!rehearsal || input.parentMint !== seed.parent.mintAddress || input.scope !== seed.parent.scope) return "order";
        const current = rehearsal.windows.get(input.windowStartMs);
        if (!current) return "order";
        if (rehearsal.status !== "open") {
          suspendControl();
          return "ok";
        }
        if (current === "claimed") rehearsal.windows.set(input.windowStartMs, input.outcome);
        if (input.outcome === "stopped") {
          rehearsal.status = "stopped";
          suspendControl();
          return "ok";
        }
        if (rehearsal.starts.every((start) => rehearsal.windows.get(start) === "ok")) {
          rehearsal.status = "closed";
          suspendControl();
        }
        return "ok";
      });
    },
    async rehearsalState(parentMint, scope) {
      const rehearsal = currentRehearsal();
      if (!rehearsal || parentMint !== seed.parent.mintAddress || scope !== seed.parent.scope) return null;
      return {
        status: rehearsal.status,
        windowStartsMs: [...rehearsal.starts],
        processed: [...rehearsal.windows].map(([windowStartMs, outcome]) => ({ windowStartMs, outcome })),
        blocksSideWork: rehearsal.blockSideWork,
      };
    },
    async rehearsalBlocksSideWork(parentMint, scope) {
      if (parentMint !== seed.parent.mintAddress || scope !== seed.parent.scope || rehearsals.length === 0) return false;
      return rehearsals.some((row) => row.blockSideWork);
    },
  };
}
