import { NextResponse } from "next/server";

import { presentedKey } from "@/lib/api/contract";
import { executePublishedSdk } from "@/lib/server/api/execute";
import { ApiFlowError } from "@/lib/server/api/errors";
import { apiFailure, readJson } from "@/lib/server/api/http";
import { accountForApiKey } from "@/lib/server/api/keys";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const header = presentedKey(request.headers.get("authorization"));
  if (!header.ok) return apiFailure(new ApiFlowError(header.code));
  try {
    const key = await accountForApiKey(header.secret);
    const body = await readJson(request);
    const record = body !== null && typeof body === "object" ? body : null;
    if (!record || !("sdkId" in record) || typeof record.sdkId !== "string") throw new ApiFlowError("invalid_input");
    const version =
      "version" in record && record.version !== undefined && record.version !== null ? record.version : null;
    if (version !== null && (typeof version !== "number" || !Number.isInteger(version) || version < 1)) {
      throw new ApiFlowError("invalid_input");
    }
    const values = "input" in record ? record.input : {};
    return NextResponse.json(
      await executePublishedSdk({
        accountId: key.accountId,
        keyId: key.keyId,
        sdkId: record.sdkId,
        version,
        values,
      }),
    );
  } catch (error) {
    return apiFailure(error);
  }
}
