import "server-only";

import { officialQuoteFromOverview, type OfficialQuote } from "@/lib/sdk/official";
import { requireBirdeye } from "@/lib/server/env";

const OVERVIEW = "https://public-api.birdeye.so/defi/token_overview";
const FRESH_MS = 10_000;

type Snapshot = {
  mint: string;
  at: number;
  result: { ok: true; updatedAt: number; quote: OfficialQuote } | { ok: false };
};

let cached: Snapshot | null = null;
let pending: Promise<Snapshot["result"]> | null = null;
let pendingMint = "";

export async function loadOfficialMarket(
  mint: string,
): Promise<{ ok: true; updatedAt: number; quote: OfficialQuote } | { ok: false }> {
  const now = Date.now();
  if (cached && cached.mint === mint && now - cached.at < FRESH_MS) return cached.result;
  if (pending && pendingMint === mint) return pending;
  pendingMint = mint;
  pending = readMarket(mint).finally(() => {
    if (pendingMint === mint) pending = null;
  });
  return pending;
}

async function readMarket(mint: string): Promise<Snapshot["result"]> {
  let apiKey: string;
  try {
    apiKey = requireBirdeye();
  } catch {
    const result = { ok: false as const };
    cached = { mint, at: Date.now(), result };
    return result;
  }
  try {
    const url = new URL(OVERVIEW);
    url.searchParams.set("address", mint);
    url.searchParams.set("ui_amount_mode", "scaled");
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-chain": "solana",
        "X-API-KEY": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      const result = { ok: false as const };
      cached = { mint, at: Date.now(), result };
      return result;
    }
    const result = { ok: true as const, updatedAt: Date.now(), quote: officialQuoteFromOverview(await response.json()) };
    cached = { mint, at: result.updatedAt, result };
    return result;
  } catch {
    const result = { ok: false as const };
    cached = { mint, at: Date.now(), result };
    return result;
  }
}
