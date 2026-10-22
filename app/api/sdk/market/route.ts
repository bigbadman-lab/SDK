import { NextResponse } from "next/server";

import { loadOfficialMarket } from "@/lib/server/market/official";
import { loadOfficialSdk } from "@/lib/server/sdk/official";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const official = await loadOfficialSdk();
  if (!official.ok) return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 503 });
  if (official.phase !== "live") return NextResponse.json({ ok: true, phase: "prelaunch", quote: null, updatedAt: null });
  const market = await loadOfficialMarket(official.mint);
  if (!market.ok) return NextResponse.json({ ok: false, phase: "live", quote: null, updatedAt: null }, { status: 503 });
  return NextResponse.json({ ok: true, phase: "live", quote: market.quote, updatedAt: market.updatedAt });
}
