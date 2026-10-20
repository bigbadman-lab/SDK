import { NextResponse } from "next/server";

import { parsePrepareBody } from "@/lib/launch/prepare";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { launchError } from "@/lib/server/launch/http";
import { assertRehearsalParent, bindRehearsalParent, prepareLaunch } from "@/lib/server/launch/service";
import { isProvisionedOperator } from "@/lib/server/operator";
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
  const rehearsal = request.headers.get("x-sdk-rehearsal") === "trest";
  if (rehearsal && !isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json(
      { error: launchMessage("parent_scope"), code: "parent_scope" },
      { status: 403 },
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
    if (rehearsal) await assertRehearsalParent();
    const review = await prepareLaunch(account, parsed.value);
    if (rehearsal) await bindRehearsalParent(account.id, review.id);
    return NextResponse.json(review);
  } catch (error) {
    return launchError(error);
  }
}
