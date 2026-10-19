import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { describeBlueprintError } from "@/lib/server/blueprint/http";
import { BlueprintFlowError } from "@/lib/server/blueprint/service";
import { createCommunitySubmission, listOwnSubmissions } from "@/lib/server/library/service";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  try {
    return NextResponse.json(await listOwnSubmissions(account));
  } catch (error) {
    const described = describeBlueprintError(error);
    if (described.code === "schema_missing") {
      return NextResponse.json(
        { error: "Library submission is unavailable.", code: described.code },
        { status: described.status },
      );
    }
    return NextResponse.json({ error: described.error, code: described.code }, { status: described.status });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "origin" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "body" }, { status: 400 });
  }
  const draftId =
    body !== null && typeof body === "object" && "draftId" in body && typeof body.draftId === "string"
      ? body.draftId
      : "";
  try {
    return NextResponse.json(await createCommunitySubmission({ account, draftId }));
  } catch (error) {
    if (error instanceof BlueprintFlowError && error.code === "submission_quota") {
      return NextResponse.json(
        {
          error: "Three community submissions are allowed each day. This submission was not created.",
          code: error.code,
          remaining: 0,
        },
        { status: 429 },
      );
    }
    const described = describeBlueprintError(error);
    if (described.code === "schema_missing") {
      return NextResponse.json(
        { error: "Library submission is unavailable.", code: described.code },
        { status: described.status },
      );
    }
    return NextResponse.json({ error: described.error, code: described.code }, { status: described.status });
  }
}
