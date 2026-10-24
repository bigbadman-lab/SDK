import { SDK_MARKET_REFRESH_MS, type SdkAllocation, type SdkSummary } from "./official.ts";
import type { RehearsalFigures, RehearsalWindowView, SdkRouteScope } from "./rehearsal.ts";

export const REWARD_REFRESH_MS = SDK_MARKET_REFRESH_MS;

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WINDOW_STATUS = new Set(["empty", "allocated", "skipped", "pending", "stopped"]);

export type RewardPollState = {
  generation: number;
  inFlight: boolean;
};

export type RewardRefresh = {
  summary: SdkSummary;
  rows: SdkAllocation[];
  nextCursor: string | null;
  figures: RehearsalFigures | null;
};

export function rewardRefreshEnabled(phase: "prelaunch" | "live" | "unavailable"): boolean {
  return phase === "live";
}

export function rewardRefreshPath(scope: SdkRouteScope): string {
  return scope === "test" ? "/api/sdk/allocations?scope=test" : "/api/sdk/allocations";
}

export function startRewardPoll(
  state: RewardPollState,
  input: { hidden: boolean; reason: "interval" | "visible" },
): { action: "skip"; state: RewardPollState } | { action: "start"; requestId: number; state: RewardPollState } {
  if (input.hidden) return { action: "skip", state };
  if (input.reason === "interval" && state.inFlight) return { action: "skip", state };
  const generation = state.generation + 1;
  return { action: "start", requestId: generation, state: { generation, inFlight: true } };
}

export function settleRewardPoll(
  state: RewardPollState,
  requestId: number,
): { apply: boolean; state: RewardPollState } {
  if (requestId !== state.generation) return { apply: false, state };
  return { apply: true, state: { generation: state.generation, inFlight: false } };
}

export function mergeAllocationRows(current: readonly SdkAllocation[], incoming: readonly SdkAllocation[]): SdkAllocation[] {
  const seen = new Set(incoming.map((row) => row.id));
  return [...incoming, ...current.filter((row) => !seen.has(row.id))];
}

export function appendAllocationRows(current: readonly SdkAllocation[], incoming: readonly SdkAllocation[]): SdkAllocation[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...incoming.filter((row) => !seen.has(row.id))];
}

export function readAllocationRows(value: unknown): SdkAllocation[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(isAllocation);
  return rows.length === value.length ? rows : null;
}

export function readRewardRefresh(body: unknown, scope: SdkRouteScope): RewardRefresh | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.phase !== "live") return null;
  const rows = readAllocationRows(record.rows);
  if (!rows) return null;
  const summary = readSummary(record.summary);
  if (!summary) return null;
  const nextCursor = record.nextCursor === null ? null : typeof record.nextCursor === "string" ? record.nextCursor : undefined;
  if (nextCursor === undefined) return null;
  if (scope === "production") return { summary, rows, nextCursor, figures: null };
  const figures = readFigures(record.figures);
  if (!figures) return null;
  return { summary, rows, nextCursor, figures };
}

function isAllocation(value: unknown): value is SdkAllocation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && row.id.length > 0
    && row.id.length <= 80
    && typeof row.windowStart === "string"
    && STAMP.test(row.windowStart)
    && typeof row.windowEnd === "string"
    && STAMP.test(row.windowEnd)
    && typeof row.owner === "string"
    && row.owner.length >= 32
    && row.owner.length <= 44
    && typeof row.balance === "string"
    && AMOUNT.test(row.balance)
    && typeof row.solLamports === "string"
    && AMOUNT.test(row.solLamports);
}

function readSummary(value: unknown): SdkSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.totalLamports !== "string" || !AMOUNT.test(row.totalLamports)) return null;
  if (typeof row.dayLamports !== "string" || !AMOUNT.test(row.dayLamports)) return null;
  const start = stampOrNull(row.latestWindowStart);
  const end = stampOrNull(row.latestWindowEnd);
  if (start === undefined || end === undefined || (start === null) !== (end === null)) return null;
  return { totalLamports: row.totalLamports, dayLamports: row.dayLamports, latestWindowStart: start, latestWindowEnd: end };
}

function readFigures(value: unknown): RehearsalFigures | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { windows?: unknown }).windows)) return null;
  const row = value as Record<string, unknown>;
  const collectedLamports = amountOrNull(row.collectedLamports);
  const distributableLamports = amountOrNull(row.distributableLamports);
  const holderLamports = amountOrNull(row.holderLamports);
  const protocolLamports = amountOrNull(row.protocolLamports);
  const reserveLamports = amountOrNull(row.reserveLamports);
  const allocatedLamports = amountOrNull(row.allocatedLamports);
  const claimableLamports = amountOrNull(row.claimableLamports);
  const claimedLamports = amountOrNull(row.claimedLamports);
  const unassignedLamports = amountOrNull(row.unassignedLamports);
  const dayLamports = amountOrNull(row.dayLamports);
  const latestStart = stampOrNull(row.latestStart);
  if (
    collectedLamports === undefined
    || distributableLamports === undefined
    || holderLamports === undefined
    || protocolLamports === undefined
    || reserveLamports === undefined
    || allocatedLamports === undefined
    || claimableLamports === undefined
    || claimedLamports === undefined
    || unassignedLamports === undefined
    || dayLamports === undefined
    || latestStart === undefined
    || typeof row.reserveSatisfied !== "boolean"
  ) return null;
  const windows: RehearsalWindowView[] = [];
  for (const item of row.windows as unknown[]) {
    const window = readWindow(item);
    if (!window) return null;
    windows.push(window);
  }
  return {
    collectedLamports,
    distributableLamports,
    holderLamports,
    protocolLamports,
    reserveLamports,
    reserveSatisfied: row.reserveSatisfied,
    allocatedLamports,
    claimableLamports,
    claimedLamports,
    unassignedLamports,
    latestStart,
    dayLamports,
    windows,
  };
}

function readWindow(value: unknown): RehearsalWindowView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const collectedLamports = amountOrNull(row.collectedLamports);
  const holderLamports = amountOrNull(row.holderLamports);
  const protocolLamports = amountOrNull(row.protocolLamports);
  const unassignedLamports = amountOrNull(row.unassignedLamports);
  const eligible = row.eligibleHolders === null
    ? null
    : typeof row.eligibleHolders === "number" && Number.isSafeInteger(row.eligibleHolders) && row.eligibleHolders >= 0
      ? row.eligibleHolders
      : undefined;
  if (
    typeof row.id !== "string"
    || row.id.length === 0
    || row.id.length > 80
    || typeof row.start !== "string"
    || !STAMP.test(row.start)
    || typeof row.status !== "string"
    || !WINDOW_STATUS.has(row.status)
    || collectedLamports === undefined
    || holderLamports === undefined
    || protocolLamports === undefined
    || unassignedLamports === undefined
    || eligible === undefined
  ) return null;
  return {
    id: row.id,
    start: row.start,
    status: row.status as RehearsalWindowView["status"],
    collectedLamports,
    holderLamports,
    protocolLamports,
    eligibleHolders: eligible,
    unassignedLamports,
  };
}

function amountOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && AMOUNT.test(value)) return value;
  return undefined;
}

function stampOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && STAMP.test(value)) return value;
  return undefined;
}
