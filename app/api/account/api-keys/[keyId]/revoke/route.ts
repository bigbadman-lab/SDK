import { NextResponse } from "next/server";

import { API_COPY } from "@/lib/api/contract";
import { getCurrentAccount } from "@/lib/server/account";
import { ApiFlowError } from "@/lib/server/api/errors";
import { apiFailure } from "@/lib/server/api/http";
import { revokeApiKey } from "@/lib/server/api/keys";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ keyId: string }> },
): Promise<NextResponse> {
  if (!trustedOrigin(request)) return apiFailure(new ApiFlowError("invalid_input", null, API_COPY.origin));
  const account = await getCurrentAccount();
  if (!account) return apiFailure(new ApiFlowError("unauthenticated"));
  const { keyId } = await context.params;
  try {
    return NextResponse.json({ key: await revokeApiKey({ account, keyId }) });
  } catch (error) {
    return apiFailure(error);
  }
}
