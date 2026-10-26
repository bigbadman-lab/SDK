import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { trustedOrigin } from "@/lib/server/origin";
import { acceptRewardClaim, prepareRewardClaim } from "@/lib/server/rewards/account";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const origin = trustedOrigin(request);
  if (!origin) return NextResponse.json({ ok: false, code: "origin" }, { status: 400 });
  const account = await getCurrentAccount();
  if (!account) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });
  const record = body as Record<string, unknown>;
  const asset = record.asset === "sol" || record.asset === "parent_token" ? record.asset : null;
  if (record.scope === "test") return NextResponse.json({ ok: false, code: "closed" }, { status: 403 });
  const scope = "production" as const;
  if (record.asset === "all") {
    return NextResponse.json({ ok: false, code: "separate", execution: "unavailable" }, { status: 400 });
  }
  if (!asset) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });
  if (record.action === "prepare") {
    const prepared = await prepareRewardClaim({ wallet: account.walletAddress, scope, asset, domain: origin.domain });
    return NextResponse.json(prepared, { status: prepared.ok ? 200 : 409 });
  }
  if (record.action !== "submit" || typeof record.nonce !== "string" || typeof record.message !== "string" || typeof record.signature !== "string") {
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });
  }
  const accepted = await acceptRewardClaim({
    wallet: account.walletAddress,
    scope,
    nonce: record.nonce,
    message: record.message,
    signature: record.signature,
    domain: origin.domain,
  });
  return NextResponse.json(accepted, { status: accepted.ok ? 200 : 409 });
}
