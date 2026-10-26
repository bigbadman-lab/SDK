import { NextResponse } from "next/server";

import { publicSdkRequest } from "@/lib/sdk/rehearsal";
import { loadOfficialMarket } from "@/lib/server/market/official";
import { loadOfficialSdk } from "@/lib/server/sdk/official";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const scope = publicSdkRequest(new URL(request.url).searchParams.get("scope"));
  if (scope === "denied") return json({ ok: false, phase: "unavailable" }, 404);
  if (scope !== "production") return json({ ok: false, phase: "unavailable" }, 400);
  const official = await loadOfficialSdk();
  if (!official.ok) return json({ ok: false, phase: "unavailable" }, 503);
  if (official.phase === "prelaunch") return json({ ok: true, phase: "prelaunch", quote: null, updatedAt: null });
  const market = await loadOfficialMarket(official.mint);
  if (!market.ok) return json({ ok: false, phase: official.phase, quote: null, updatedAt: null }, 503);
  return json({ ok: true, phase: official.phase, quote: market.quote, updatedAt: market.updatedAt });
}
