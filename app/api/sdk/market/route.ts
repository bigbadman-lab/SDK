import { NextResponse } from "next/server";

import { publicSdkRequest } from "@/lib/sdk/rehearsal";
import { loadOfficialMarket } from "@/lib/server/market/official";
import { loadOfficialSdk } from "@/lib/server/sdk/official";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const scope = publicSdkRequest(new URL(request.url).searchParams.get("scope"));
  if (scope === "denied") return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 404 });
  if (scope !== "production") return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 400 });
  const official = await loadOfficialSdk();
  if (!official.ok) return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 503 });
  if (official.phase !== "live") return NextResponse.json({ ok: true, phase: "prelaunch", quote: null, updatedAt: null });
  const market = await loadOfficialMarket(official.mint);
  if (!market.ok) return NextResponse.json({ ok: false, phase: "live", quote: null, updatedAt: null }, { status: 503 });
  return NextResponse.json({ ok: true, phase: "live", quote: market.quote, updatedAt: market.updatedAt });
}
