import { NextResponse } from "next/server";

import { builderFailureCode } from "@/lib/launch/builder-probe";
import { parseLauncherBuildRequest } from "@/lib/launch/builder-request";
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
  if (code === "body" || code === "mint") return 400;
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
  const parsed = parseLauncherBuildRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: launchMessage("body"), code: "body" }, { status: 400 });
  }
  const result = await requestUnsignedBuild({
    accountId: account.id,
    launchId: parsed.value.launchId,
    mintPublicKey: parsed.value.mintPublicKey,
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
