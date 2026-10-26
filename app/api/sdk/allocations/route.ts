import { NextResponse } from "next/server";

import { readAllocationCursor } from "@/lib/sdk/official";
import { publicSdkRequest } from "@/lib/sdk/rehearsal";
import { loadHolderAllocations, loadOfficialSdk } from "@/lib/server/sdk/official";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const scope = publicSdkRequest(url.searchParams.get("scope"));
  if (scope === "denied") return json({ ok: false, rows: [] }, 404);
  if (scope !== "production") return json({ ok: false, rows: [] }, 400);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : readAllocationCursor(rawCursor);
  if (rawCursor !== null && !cursor) return json({ ok: false, rows: [] }, 400);
  const official = await loadOfficialSdk();
  if (!official.ok) return json({ ok: false, phase: "unavailable", rows: [] }, 503);
  if (official.phase === "registered") return json({ ok: true, phase: "registered", rows: [], nextCursor: null, summary: null });
  if (official.phase !== "live") return json({ ok: true, phase: "prelaunch", rows: [], nextCursor: null, summary: null });
  const page = await loadHolderAllocations(official.mint, cursor);
  if (!page.ok) return json({ ok: false, phase: "live", rows: [] }, 503);
  return json({
    ok: true,
    phase: "live",
    rows: page.rows,
    nextCursor: page.nextCursor,
    summary: cursor ? null : page.summary,
  });
}
