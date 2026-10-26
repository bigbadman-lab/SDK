import { recognizedReserveWithheld } from "../rewards/ledger.ts";

export type SdkRouteScope = "production" | "test";

export type RehearsalWindowStatus = "empty" | "allocated" | "skipped" | "pending" | "stopped";

export type RehearsalWindowView = {
  id: string;
  start: string;
  status: RehearsalWindowStatus;
  collectedLamports: string | null;
  holderLamports: string | null;
  protocolLamports: string | null;
  eligibleHolders: number | null;
  unassignedLamports: string | null;
};

export type RehearsalFigures = {
  collectedLamports: string | null;
  distributableLamports: string | null;
  holderLamports: string | null;
  protocolLamports: string | null;
  reserveLamports: string | null;
  reserveSatisfied: boolean;
  allocatedLamports: string | null;
  claimableLamports: string | null;
  claimedLamports: string | null;
  unassignedLamports: string | null;
  latestStart: string | null;
  dayLamports: string | null;
  windows: RehearsalWindowView[];
};

export type HistoricalRecoveryView = {
  netLamports: string;
  reserveLamports: string;
  holderLamports: string;
  buybackLamports: string;
  protocolLamports: string;
};

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function readSdkRouteScope(value: string | undefined): SdkRouteScope | null {
  if (value === undefined) return "production";
  if (value === "test") return "test";
  return null;
}

export function publicSdkRequest(value: string | null | undefined): "production" | "denied" | "invalid" {
  if (value === "test") return "denied";
  return readSdkRouteScope(value ?? undefined) === "production" ? "production" : "invalid";
}

function amount(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

function add(total: bigint, value: string): bigint | null {
  const parsed = amount(value);
  if (parsed === null) return null;
  return total + parsed;
}

export function composeRehearsalLedger(input: {
  collections: readonly { netLamports: string; deferred: boolean }[];
  windows: readonly {
    id: string;
    startMs: number;
    collectedLamports: string;
    holderLamports: string;
    protocolLamports: string;
    snapshotLamports: string;
    eligibleHolders: number;
  }[];
  rehearsal: readonly { startMs: number; outcome: "claimed" | "ok" | "stopped" | "skipped" }[];
  claimedLamports: string;
  reserveLamports: string | null;
  recognizedReserveLamports: string | null;
  nowMs: number;
}): RehearsalFigures | null {
  const claimed = amount(input.claimedLamports);
  if (claimed === null || !Number.isInteger(input.nowMs)) return null;
  const financial = new Map(input.windows.map((row) => [row.startMs, row]));
  const seen = new Set<number>();
  const windows: RehearsalWindowView[] = [];
  const push = (row: RehearsalWindowView, startMs: number) => {
    if (seen.has(startMs)) return;
    seen.add(startMs);
    windows.push(row);
  };
  for (const row of input.rehearsal) {
    const reward = financial.get(row.startMs);
    if (row.outcome === "skipped" || row.outcome === "claimed" || row.outcome === "stopped" || !reward) {
      push({
        id: `rehearsal-${row.startMs}`,
        start: new Date(row.startMs).toISOString(),
        status: row.outcome === "claimed" ? "pending" : row.outcome === "ok" ? "empty" : row.outcome,
        collectedLamports: null,
        holderLamports: null,
        protocolLamports: null,
        eligibleHolders: null,
        unassignedLamports: null,
      }, row.startMs);
      continue;
    }
    const unassigned = unassignedLamports(reward.holderLamports, reward.snapshotLamports);
    if (unassigned === null) return null;
    push({
      id: reward.id,
      start: new Date(row.startMs).toISOString(),
      status: "allocated",
      collectedLamports: reward.collectedLamports,
      holderLamports: reward.holderLamports,
      protocolLamports: reward.protocolLamports,
      eligibleHolders: reward.eligibleHolders,
      unassignedLamports: unassigned,
    }, row.startMs);
  }
  for (const reward of input.windows) {
    if (seen.has(reward.startMs)) continue;
    const unassigned = unassignedLamports(reward.holderLamports, reward.snapshotLamports);
    if (unassigned === null) return null;
    push({
      id: reward.id,
      start: new Date(reward.startMs).toISOString(),
      status: "allocated",
      collectedLamports: reward.collectedLamports,
      holderLamports: reward.holderLamports,
      protocolLamports: reward.protocolLamports,
      eligibleHolders: reward.eligibleHolders,
      unassignedLamports: unassigned,
    }, reward.startMs);
  }
  windows.sort((left, right) => (left.start < right.start ? 1 : left.start > right.start ? -1 : 0));
  const activeCollections = input.collections.filter((row) => !row.deferred);
  const hasFinancial = input.windows.length > 0 || activeCollections.length > 0;
  const collected = sum(activeCollections.map((row) => row.netLamports));
  const distributable = sum(input.windows.map((row) => row.collectedLamports));
  const holders = sum(input.windows.map((row) => row.holderLamports));
  const protocol = sum(input.windows.map((row) => row.protocolLamports));
  const allocated = sum(input.windows.map((row) => row.snapshotLamports));
  const unassigned = sum(windows.flatMap((row) => row.unassignedLamports === null ? [] : [row.unassignedLamports]));
  if (collected === null || distributable === null || holders === null || protocol === null || allocated === null || unassigned === null) {
    return null;
  }
  const day = sum(input.windows.filter((row) => row.startMs >= input.nowMs - DAY_MS).map((row) => row.holderLamports));
  if (day === null) return null;
  const reserve = input.reserveLamports === null ? null : amount(input.reserveLamports);
  const recognized = input.recognizedReserveLamports === null ? null : amount(input.recognizedReserveLamports);
  if (input.reserveLamports !== null && reserve === null) return null;
  if (input.recognizedReserveLamports !== null && recognized === null) return null;
  const latest = windows[0]?.start ?? null;
  return {
    collectedLamports: hasFinancial ? collected.toString() : null,
    distributableLamports: input.windows.length > 0 ? distributable.toString() : null,
    holderLamports: input.windows.length > 0 ? holders.toString() : null,
    protocolLamports: input.windows.length > 0 ? protocol.toString() : null,
    reserveLamports: reserve === null ? null : reserve.toString(),
    reserveSatisfied: reserve !== null && recognized !== null && recognized >= reserve,
    allocatedLamports: input.windows.length > 0 ? allocated.toString() : null,
    claimableLamports: input.windows.length > 0 ? (allocated > claimed ? allocated - claimed : BigInt(0)).toString() : null,
    claimedLamports: claimed > BigInt(0) || input.windows.length > 0 ? claimed.toString() : null,
    unassignedLamports: windows.some((row) => row.unassignedLamports !== null) ? unassigned.toString() : null,
    latestStart: latest,
    dayLamports: input.windows.length > 0 ? day.toString() : null,
    windows,
  };
}

export function reserveAlreadyRecognized(input: {
  reserveLamports: string;
  allocated: readonly { signature: string; reserveWithheldLamports: string }[];
  recoveries: readonly { signature: string; reserveWithheldLamports: string }[];
}): string | null {
  const recognized = recognizedReserveWithheld(input);
  return recognized.ok ? recognized.withheld : null;
}

function unassignedLamports(holders: string, snapshots: string): string | null {
  const holder = amount(holders);
  const snapshot = amount(snapshots);
  if (holder === null || snapshot === null || snapshot > holder) return null;
  return (holder - snapshot).toString();
}

function sum(values: readonly string[]): bigint | null {
  let total = BigInt(0);
  for (const value of values) {
    const next = add(total, value);
    if (next === null) return null;
    total = next;
  }
  return total;
}
