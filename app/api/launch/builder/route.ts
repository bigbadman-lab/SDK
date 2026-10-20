import { NextResponse } from "next/server";

import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { probeTransactionBuilder } from "@/lib/server/launch/unsigned";
import { isProvisionedOperator } from "@/lib/server/operator";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
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
  if (!isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const result = await probeTransactionBuilder();
  if (!result.ok) {
    const status = result.code === "builder_unconfigured" ? 503 : 502;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, ...result.report });
}
