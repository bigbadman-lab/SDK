import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { API_COPY } from "@/lib/api/contract";
import { apiFailure, readJson } from "@/lib/server/api/http";
import { ApiFlowError } from "@/lib/server/api/errors";
import { createApiKey, listApiKeys } from "@/lib/server/api/keys";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) return apiFailure(new ApiFlowError("unauthenticated"));
  try {
    return NextResponse.json(await listApiKeys(account));
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) return apiFailure(new ApiFlowError("invalid_input", null, API_COPY.origin));
  const account = await getCurrentAccount();
  if (!account) return apiFailure(new ApiFlowError("unauthenticated"));
  try {
    const body = await readJson(request);
    const label =
      body !== null && typeof body === "object" && "label" in body && typeof body.label === "string" ? body.label : "";
    return NextResponse.json(await createApiKey({ account, label }));
  } catch (error) {
    return apiFailure(error);
  }
}
