import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { blueprintError } from "@/lib/server/blueprint/http";
import { listDrafts } from "@/lib/server/blueprint/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  try {
    return NextResponse.json({ drafts: await listDrafts(account) });
  } catch (error) {
    return blueprintError(error);
  }
}
