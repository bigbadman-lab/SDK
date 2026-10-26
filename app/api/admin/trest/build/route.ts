import { NextResponse } from "next/server";

import { parseLauncherBuildRequest } from "@/lib/launch/builder-request";
import { publicChildLaunchesOpen } from "@/lib/launch/public-launch";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { rehearsalBoundMint, requestRehearsalBuild } from "@/lib/server/launch/unsigned";
import { isProvisionedOperator } from "@/lib/server/operator";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function statusFor(code: string): number {
  if (code === "not_found") return 404;
  if (code === "mint_conflict" || code === "conflict") return 409;
  if (code === "parent_scope" || code === "body" || code === "mint") return 400;
  if (code === "not_ready" || code === "parent_unregistered" || code === "simulation_failed") return 422;
  if (code === "builder_unconfigured" || code === "unavailable") return 503;
  return 502;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) return NextResponse.json({ ok: false, code: "origin" }, { status: 400 });
  const account = await getCurrentAccount();
  if (!account || !isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  if (!publicChildLaunchesOpen()) {
    return NextResponse.json({ ok: false, code: "closed" }, { status: 403 });
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
  const keys = Object.keys(record).map((key) => key.toLowerCase());
  if (keys.some((key) => ["parent", "parentmint", "quotemint", "scope", "symbol", "deployer"].includes(key))) {
    return NextResponse.json({ ok: false, code: "parent_scope" }, { status: 400 });
  }
  if (typeof record.launchId === "string" && UUID.test(record.launchId) && !("mintPublicKey" in record)) {
    const bound = await rehearsalBoundMint({ accountId: account.id, launchId: record.launchId });
    if (!bound.ok) {
      return NextResponse.json({ ok: false, error: launchMessage(bound.code), code: bound.code }, { status: statusFor(bound.code) });
    }
    return NextResponse.json({ ok: true, boundMint: bound.boundMint, authorized: false });
  }
  const parsed = parseLauncherBuildRequest(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, code: parsed.code }, { status: 400 });
  const result = await requestRehearsalBuild({
    accountId: account.id,
    launchId: parsed.value.launchId,
    mintPublicKey: parsed.value.mintPublicKey,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: launchMessage(result.code), code: result.code }, { status: statusFor(result.code) });
  }
  return NextResponse.json(result.body);
}
