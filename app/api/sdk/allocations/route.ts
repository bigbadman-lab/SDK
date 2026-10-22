import { NextResponse } from "next/server";

import { readAllocationCursor } from "@/lib/sdk/official";
import { loadHolderAllocations, loadOfficialSdk } from "@/lib/server/sdk/official";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const rawCursor = new URL(request.url).searchParams.get("cursor");
  const cursor = rawCursor === null ? null : readAllocationCursor(rawCursor);
  if (rawCursor !== null && !cursor) return NextResponse.json({ ok: false, rows: [] }, { status: 400 });
  const official = await loadOfficialSdk();
  if (!official.ok) return NextResponse.json({ ok: false, phase: "unavailable", rows: [] }, { status: 503 });
  if (official.phase !== "live") {
    return NextResponse.json({ ok: true, phase: "prelaunch", rows: [], nextCursor: null, summary: null });
  }
  const page = await loadHolderAllocations(official.mint, cursor);
  if (!page.ok) return NextResponse.json({ ok: false, phase: "live", rows: [] }, { status: 503 });
  return NextResponse.json({
    ok: true,
    phase: "live",
    rows: page.rows,
    nextCursor: page.nextCursor,
    summary: cursor ? null : page.summary,
  });
}
