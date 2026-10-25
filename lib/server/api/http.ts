import "server-only";

import { NextResponse } from "next/server";

import { API_BODY_LIMIT_BYTES, API_COPY } from "@/lib/api/contract";
import { ApiFlowError } from "@/lib/server/api/errors";

export function apiFailure(error: unknown): NextResponse {
  const described = error instanceof ApiFlowError ? error : new ApiFlowError("internal_error");
  console.error(`[api] ${described.code}`);
  return NextResponse.json(
    {
      error: {
        code: described.code,
        message: described.message,
        ...(described.remaining === null ? {} : { remaining: described.remaining }),
      },
    },
    { status: described.status },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > API_BODY_LIMIT_BYTES) throw new ApiFlowError("invalid_input", null, API_COPY.bodyTooLarge);
  const text = await request.text();
  if (text.length > API_BODY_LIMIT_BYTES) throw new ApiFlowError("invalid_input", null, API_COPY.bodyTooLarge);
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiFlowError("invalid_input", null, API_COPY.invalidJson);
  }
}
