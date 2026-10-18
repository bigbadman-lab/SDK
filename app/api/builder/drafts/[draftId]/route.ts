import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { readDraft } from "@/lib/server/blueprint/service";

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
