import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { remixPublishedSdk } from "@/lib/server/library/service";
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
    return NextResponse.json({ error: "Sign in to remix this SDK.", code: "unauthenticated" }, { status: 401 });
  }
  const { sdkId } = await context.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const versionId =
    body !== null && typeof body === "object" && "versionId" in body && typeof body.versionId === "string"
      ? body.versionId
      : null;
  try {
    return NextResponse.json(await remixPublishedSdk({ account, sdkId, versionId }));
  } catch (error) {
    return blueprintError(error);
  }
}
