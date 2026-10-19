import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { testPublishedSdk } from "@/lib/server/library/service";
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
    return NextResponse.json({ error: "Sign in to test this SDK.", code: "unauthenticated" }, { status: 401 });
  }
  const { sdkId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "body" }, { status: 400 });
  }
  const record = body !== null && typeof body === "object" ? body : {};
  const versionId = "versionId" in record && typeof record.versionId === "string" ? record.versionId : null;
  const values = "inputs" in record ? record.inputs : undefined;
  try {
    return NextResponse.json(
      await testPublishedSdk({
        account,
        sdkId,
        versionId,
        values,
      }),
    );
  } catch (error) {
    return blueprintError(error);
  }
}
