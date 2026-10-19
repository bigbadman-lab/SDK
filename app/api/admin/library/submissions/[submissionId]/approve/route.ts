import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { approveCommunitySubmission } from "@/lib/server/library/service";
import { isProvisionedOperator } from "@/lib/server/operator";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "origin" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  if (!isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json({ error: "That action is not available.", code: "forbidden" }, { status: 403 });
  }
  const { submissionId } = await context.params;
  try {
    return NextResponse.json(await approveCommunitySubmission({ reviewer: account, submissionId }));
  } catch (error) {
    return blueprintError(error);
  }
}
