import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { testDraft } from "@/lib/server/blueprint/service";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The blueprint request was not accepted.", code: "body" }, { status: 400 });
  }
  const values =
    typeof body === "object" && body !== null && "inputs" in body
      ? body.inputs
      : undefined;
  try {
    return NextResponse.json(await testDraft({ account, draftId, values }));
  } catch (error) {
    return blueprintError(error);
  }
}
