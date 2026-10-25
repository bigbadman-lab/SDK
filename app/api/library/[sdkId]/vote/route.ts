import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { castLibraryVote } from "@/lib/server/library/votes";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ sdkId: string }> },
): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "origin" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to like this SDK.", code: "unauthenticated" }, { status: 401 });
  }
  const { sdkId } = await context.params;
  try {
    const vote = await castLibraryVote({ account, sdkId });
    if (!vote.accepted) {
      return NextResponse.json(
        {
          error: "You can like this SDK once every 24 hours.",
          code: "vote_window",
          count: vote.count,
          voted: true,
          retryAt: vote.retryAt,
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ count: vote.count, voted: true, retryAt: vote.retryAt });
  } catch (error) {
    return blueprintError(error);
  }
}
