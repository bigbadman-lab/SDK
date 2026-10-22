import "server-only";

import { quoteFromOverview, type MarketQuote } from "@/lib/market/quote";
import { requireBirdeye } from "@/lib/server/env";

const OVERVIEW = "https://public-api.birdeye.so/defi/token_overview";
const FRESH_MS = 1_500;
const MAX_MINTS = 20;

type Snapshot = {
  key: string;
  at: number;
  result: { ok: true; updatedAt: number; quotes: Record<string, MarketQuote> } | { ok: false };
};

let cached: Snapshot | null = null;
let pending: Promise<Snapshot["result"]> | null = null;
let pendingKey = "";

const blank = (): MarketQuote => ({ fdv: null, volumeUsd: null, holders: null });

async function readOverview(mint: string, key: string): Promise<MarketQuote> {
  try {
    const url = new URL(OVERVIEW);
    url.searchParams.set("address", mint);
    url.searchParams.set("ui_amount_mode", "scaled");
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-chain": "solana",
        "X-API-KEY": key,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return blank();
    return quoteFromOverview(await response.json());
  } catch {
    return blank();
  }
}

export async function loadPairedMarkets(
  mints: readonly string[],
): Promise<{ ok: true; updatedAt: number; quotes: Record<string, MarketQuote> } | { ok: false }> {
  const unique = [...new Set(mints.filter((mint) => mint.length > 0))].slice(0, MAX_MINTS);
  const key = unique.slice().sort().join(",");
  const now = Date.now();
  if (cached && cached.key === key && now - cached.at < FRESH_MS) return cached.result;
  if (pending && pendingKey === key) return pending;
  pendingKey = key;
  pending = readMarkets(unique, key).finally(() => {
    if (pendingKey === key) pending = null;
  });
  return pending;
}

async function readMarkets(
  mints: readonly string[],
  key: string,
): Promise<Snapshot["result"]> {
  let apiKey: string;
  try {
    apiKey = requireBirdeye();
  } catch {
    const result = { ok: false as const };
    cached = { key, at: Date.now(), result };
    return result;
  }
  const rows = await Promise.all(mints.map(async (mint) => [mint, await readOverview(mint, apiKey)] as const));
  const result = { ok: true as const, updatedAt: Date.now(), quotes: Object.fromEntries(rows) };
  cached = { key, at: result.updatedAt, result };
  return result;
}
