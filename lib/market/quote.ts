export type MarketQuote = {
  fdv: number | null;
  volumeUsd: number | null;
  holders: number | null;
};

const EMPTY: MarketQuote = { fdv: null, volumeUsd: null, holders: null };

function finite(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function quoteFromOverview(body: unknown): MarketQuote {
  if (!body || typeof body !== "object" || !("data" in body)) return EMPTY;
  const data = body.data;
  if (!data || typeof data !== "object") return EMPTY;
  const row = data as Record<string, unknown>;
  return {
    fdv: finite(row.fdv),
    volumeUsd: finite(row.v24hUSD),
    holders: finite(row.holder),
  };
}

export function formatUsd(value: number | null): string {
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

export function formatCount(value: number | null): string {
  if (value === null) return "—";
  if (value < 10_000) return Math.round(value).toLocaleString("en-US");
  return formatUsd(value).slice(1);
}

export function formatAge(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
