import { NextResponse } from "next/server";

import { publicSdkRequest } from "@/lib/sdk/rehearsal";
import { getCurrentAccount } from "@/lib/server/account";
import { loadAccountRewards } from "@/lib/server/rewards/account";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const scope = publicSdkRequest(new URL(request.url).searchParams.get("scope"));
  if (scope === "denied") return NextResponse.json({ error: "This view is not available." }, { status: 404 });
  if (scope !== "production") return NextResponse.json({ error: "This view is not available." }, { status: 400 });
  const view = await loadAccountRewards(account.walletAddress, "production");
  return NextResponse.json(view);
}
