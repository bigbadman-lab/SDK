import { NextResponse } from "next/server";

import { builderFailureCode } from "@/lib/launch/builder-probe";
import { publicLaunchScope } from "@/lib/launch/parent-scope";
import { publicChildLaunchesOpen } from "@/lib/launch/public-launch";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { requestUnsignedBuild } from "@/lib/server/launch/unsigned";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

function statusFor(code: string): number {
  if (code === "not_found") return 404;
  if (code === "conflict") return 409;
  if (code === "not_ready" || code === "simulation_failed" || code === "lineage" || code === "slippage") {
    return 422;
  }
  if (code === "builder_unconfigured" || code === "parent_unregistered" || code === "parent_ineligible") {
    return 503;
  }
  if (code === "body" || code === "mint" || code === "parent_scope") return 400;
  return 502;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ ok: false, code: "origin" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      { ok: false, error: launchMessage("unauthenticated"), code: "unauthenticated" },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: launchMessage("body"), code: "body" }, { status: 400 });
  }
  if (request.headers.get("x-sdk-rehearsal") === "trest") {
    return NextResponse.json({ ok: false, error: launchMessage("parent_scope"), code: "parent_scope" }, { status: 403 });
  }
  if (!publicChildLaunchesOpen()) {
    return NextResponse.json({ ok: false, error: launchMessage("closed"), code: "closed" }, { status: 403 });
  }
  const parsed = publicLaunchScope(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: launchMessage(parsed.code), code: parsed.code }, { status: 400 });
  }
  const result = await requestUnsignedBuild({
    accountId: account.id,
    launchId: parsed.launchId,
    mintPublicKey: parsed.mintPublicKey,
  });
  if (!result.ok) {
    const code = builderFailureCode({ code: result.code });
    return NextResponse.json(
      { ok: false, error: launchMessage(code), code },
      { status: statusFor(code) },
    );
  }
  return NextResponse.json(result.body);
}
