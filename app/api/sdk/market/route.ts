import { NextResponse } from "next/server";

import { readSdkRouteScope } from "@/lib/sdk/rehearsal";
import { loadOfficialMarket } from "@/lib/server/market/official";
import { loadRehearsalParent } from "@/lib/server/sdk/rehearsal";
import { loadOfficialSdk } from "@/lib/server/sdk/official";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const raw = new URL(request.url).searchParams.get("scope");
  const scope = raw === null ? "production" : readSdkRouteScope(raw);
  if (!scope) return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 400 });
  if (scope === "test") {
    const rehearsal = await loadRehearsalParent();
    if (!rehearsal.ok) return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 503 });
    if (rehearsal.phase !== "live") return NextResponse.json({ ok: true, phase: "prelaunch", quote: null, updatedAt: null });
    const market = await loadOfficialMarket(rehearsal.mint);
    if (!market.ok) return NextResponse.json({ ok: false, phase: "live", quote: null, updatedAt: null }, { status: 503 });
    return NextResponse.json({ ok: true, phase: "live", quote: market.quote, updatedAt: market.updatedAt });
  }
  const official = await loadOfficialSdk();
  if (!official.ok) return NextResponse.json({ ok: false, phase: "unavailable" }, { status: 503 });
  if (official.phase !== "live") return NextResponse.json({ ok: true, phase: "prelaunch", quote: null, updatedAt: null });
  const market = await loadOfficialMarket(official.mint);
  if (!market.ok) return NextResponse.json({ ok: false, phase: "live", quote: null, updatedAt: null }, { status: 503 });
  return NextResponse.json({ ok: true, phase: "live", quote: market.quote, updatedAt: market.updatedAt });
}
