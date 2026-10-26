import { TREST_MINT } from "../launch/verified-launch.ts";

export const SDK_MARKET_REFRESH_MS = 15_000;
export const SDK_ALLOCATION_PAGE = 20;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type OfficialQuote = {
  marketCapUsd: number | null;
  priceUsd: number | null;
  volumeUsd: number | null;
  holders: number | null;
};

export type SdkAllocation = {
  id: string;
  windowStart: string;
  windowEnd: string;
  owner: string;
  balance: string;
  solLamports: string;
};

export type SdkSummary = {
  totalLamports: string;
  dayLamports: string;
  latestWindowStart: string | null;
  latestWindowEnd: string | null;
};

const EMPTY_QUOTE: OfficialQuote = {
  marketCapUsd: null,
  priceUsd: null,
  volumeUsd: null,
  holders: null,
};

function finite(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export type OfficialPhase = "prelaunch" | "registered" | "live";

export function acceptOfficialMint(
  mint: string | null,
  decimals: number | null,
): { mint: string; decimals: number | null } | null {
  if (!mint || mint === TREST_MINT || !MINT.test(mint)) return null;
  const scale = typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 9 ? decimals : null;
  return { mint, decimals: scale };
}

export function canonicalPhase(input: {
  mint: string | null;
  decimals: number | null;
  rewardsActive: boolean;
}): { phase: "prelaunch" } | { phase: "registered" | "live"; mint: string; decimals: number | null } {
  const accepted = acceptOfficialMint(input.mint, input.decimals);
  if (!accepted) return { phase: "prelaunch" };
  if (input.rewardsActive) return { phase: "live", mint: accepted.mint, decimals: accepted.decimals };
  return { phase: "registered", mint: accepted.mint, decimals: accepted.decimals };
}

export function rewardsAreActive(phase: OfficialPhase | "unavailable"): boolean {
  return phase === "live";
}

export function visibleOfficialMint(phase: OfficialPhase | "unavailable", mint: string | null): string | null {
  if ((phase === "registered" || phase === "live") && mint) return mint;
  return null;
}

export function officialIdentity(official: {
  ok: true;
  phase: "prelaunch";
} | {
  ok: true;
  phase: "registered" | "live";
  mint: string;
  decimals: number | null;
} | { ok: false }): {
  phase: OfficialPhase | "unavailable";
  mint: string | null;
  decimals: number | null;
  rewardsActive: boolean;
} {
  if (!official.ok) return { phase: "unavailable", mint: null, decimals: null, rewardsActive: false };
  if (official.phase === "prelaunch") return { phase: "prelaunch", mint: null, decimals: null, rewardsActive: false };
  return {
    phase: official.phase,
    mint: visibleOfficialMint(official.phase, official.mint),
    decimals: official.decimals,
    rewardsActive: rewardsAreActive(official.phase),
  };
}

export function officialQuoteFromOverview(body: unknown): OfficialQuote {
  if (!body || typeof body !== "object" || !("data" in body)) return EMPTY_QUOTE;
  const data = body.data;
  if (!data || typeof data !== "object") return EMPTY_QUOTE;
  const row = data as Record<string, unknown>;
  return {
    marketCapUsd: finite(row.marketCap),
    priceUsd: finite(row.price),
    volumeUsd: finite(row.v24hUSD),
    holders: finite(row.holder),
  };
}

export function formatUsdCompact(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const units: readonly [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      const digits = scaled >= 100 ? 0 : 1;
      return `$${scaled.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
    }
  }
  if (abs >= 100) return `$${value.toFixed(0)}`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function formatTokenPrice(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0";
  if (value >= 1) return formatUsdCompact(value);
  const digits = value >= 0.01 ? 4 : value >= 0.0001 ? 6 : 8;
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatHolderCount(value: number | null): string {
  if (value === null) return "—";
  return group(String(Math.round(value)));
}

export function formatSol(lamports: string): string {
  if (!AMOUNT.test(lamports)) return "—";
  const value = BigInt(lamports);
  const whole = value / BigInt(1_000_000_000);
  const fraction = (value % BigInt(1_000_000_000)).toString().padStart(9, "0").replace(/0+$/, "");
  const text = fraction.length === 0 ? group(whole.toString()) : `${group(whole.toString())}.${fraction}`;
  return `${text} SOL`;
}

export function formatTokenBalance(raw: string, decimals: number | null): string {
  if (decimals === null || !AMOUNT.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) return "—";
  const value = BigInt(raw);
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = decimals === 0 ? "" : (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? group(whole.toString()) : `${group(whole.toString())}.${fraction}`;
}

export function formatUtcStamp(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${clock(date)} UTC`;
}

export function formatWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (!sameDay) return `${formatUtcStamp(start.getTime())} – ${formatUtcStamp(end.getTime())}`;
  return `${dateText(start)}, ${hours(start)}–${hours(end)} UTC`;
}

export function allocationCursor(startIso: string, id: string): string | null {
  if (!CURSOR.test(`${startIso}~${id}`)) return null;
  return `${startIso}~${id}`;
}

export function readAllocationCursor(value: string | null): { start: string; id: string } | null {
  if (!value) return null;
  const match = CURSOR.exec(value);
  if (!match) return null;
  return { start: match[1] ?? "", id: (match[2] ?? "").toLowerCase() };
}

function group(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function hours(date: Date): string {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function clock(date: Date): string {
  return `${hours(date)}:${pad(date.getUTCSeconds())}`;
}

function dateText(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
