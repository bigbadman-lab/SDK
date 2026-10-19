import { NextResponse } from "next/server";

import { parsePrepareBody } from "@/lib/launch/prepare";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { launchError } from "@/lib/server/launch/http";
import { prepareLaunch } from "@/lib/server/launch/service";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json(
      { error: "The launch request was not accepted.", code: "origin" },
      { status: 400 }
    );
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      { error: "Sign in to prepare a launch.", code: "unauthenticated" },
      { status: 401 }
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: launchMessage("body"), code: "body" },
      { status: 400 }
    );
  }
  const parsed = parsePrepareBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: launchMessage(parsed.code), code: parsed.code },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(await prepareLaunch(account, parsed.value));
  } catch (error) {
    return launchError(error);
  }
}
