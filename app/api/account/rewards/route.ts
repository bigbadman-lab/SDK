import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { loadAccountRewards, rewardScope } from "@/lib/server/rewards/account";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const scope = rewardScope(new URL(request.url).searchParams.get("scope"));
  const view = await loadAccountRewards(account.walletAddress, scope);
  return NextResponse.json(view);
}
