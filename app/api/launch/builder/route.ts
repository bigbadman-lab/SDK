import { NextResponse } from "next/server";

import { authorizeBuilderDiagnostic } from "@/lib/launch/builder-diagnostic";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { readOptionalEnv } from "@/lib/server/env";
import { probeTransactionBuilder } from "@/lib/server/launch/unsigned";
import { isProvisionedOperator } from "@/lib/server/operator";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const account = await getCurrentAccount();
  const gate = authorizeBuilderDiagnostic({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    configuredAppUrl: readOptionalEnv("NEXT_PUBLIC_APP_URL") ?? null,
    account,
    operator: account ? isProvisionedOperator(account.walletAddress) : false,
  });
  if (!gate.ok) {
    return NextResponse.json(
      gate.code === "unauthenticated"
        ? { ok: false, error: launchMessage("unauthenticated"), code: gate.code }
        : { ok: false, code: gate.code },
      { status: gate.status },
    );
  }
  const result = await probeTransactionBuilder();
  if (!result.ok) {
    const status = result.code === "builder_unconfigured" ? 503 : 502;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, ...result.report });
}
