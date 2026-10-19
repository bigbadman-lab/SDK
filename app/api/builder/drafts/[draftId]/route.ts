import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { deleteSavedDraft, readDraft } from "@/lib/server/blueprint/service";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ draftId: string }> },
): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  const { draftId } = await context.params;
  try {
    return NextResponse.json(await readDraft(account, draftId));
  } catch (error) {
    return blueprintError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "origin" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  const { draftId } = await context.params;
  try {
    return NextResponse.json(await deleteSavedDraft({ account, draftId }));
  } catch (error) {
    return blueprintError(error);
  }
}
