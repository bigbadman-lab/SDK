import { NextResponse } from "next/server";

import { loadVerifiedLaunches } from "@/lib/server/launch/discover";
import { loadPairedMarkets } from "@/lib/server/market/birdeye";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request): Promise<NextResponse> {
  const requested = new URL(request.url).searchParams.get("mint");
  if (requested && !MINT.test(requested)) {
    return NextResponse.json({ ok: false, quotes: {} }, { status: 400 });
  }
  const loaded = await loadVerifiedLaunches(requested ? { mint: requested } : {});
  if (!loaded.ok) {
    return NextResponse.json({ ok: false, quotes: {} }, { status: 503 });
  }
  const markets = await loadPairedMarkets(loaded.launches.map((launch) => launch.childMint));
  if (!markets.ok) return NextResponse.json({ ok: false, quotes: {} }, { status: 503 });
  return NextResponse.json(markets);
}
