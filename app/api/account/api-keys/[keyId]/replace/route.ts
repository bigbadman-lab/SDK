import { NextResponse } from "next/server";

import { API_COPY } from "@/lib/api/contract";
import { getCurrentAccount } from "@/lib/server/account";
import { ApiFlowError } from "@/lib/server/api/errors";
import { apiFailure, readJson } from "@/lib/server/api/http";
import { replaceApiKey } from "@/lib/server/api/keys";
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
    const body = await readJson(request);
    const label =
      body !== null && typeof body === "object" && "label" in body && typeof body.label === "string" ? body.label : "";
    return NextResponse.json(await replaceApiKey({ account, keyId, label }));
  } catch (error) {
    return apiFailure(error);
  }
}
