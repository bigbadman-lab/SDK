import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { approveRehearsal } from "@/lib/server/launch/submit";
import { isProvisionedOperator } from "@/lib/server/operator";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) return NextResponse.json({ ok: false, code: "origin" }, { status: 400 });
  const account = await getCurrentAccount();
  if (!account || !isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: "body" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (typeof record.launchId !== "string" || !UUID.test(record.launchId)) {
    return NextResponse.json({ ok: false, code: "body" }, { status: 400 });
  }
  if (typeof record.buildId !== "string" || !UUID.test(record.buildId)) {
    return NextResponse.json({ ok: false, code: "body" }, { status: 400 });
  }
  const result = await approveRehearsal({
    accountId: account.id,
    approver: account.walletAddress,
    launchId: record.launchId,
    buildId: record.buildId,
  });
  if (!result.ok) {
    const status = result.code === "not_ready" || result.code === "unavailable" ? 503 : result.code === "not_found" ? 404 : 422;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ ok: true, broadcast: false });
}
