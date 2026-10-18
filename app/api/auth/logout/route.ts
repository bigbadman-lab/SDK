import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";
import { revokeSession } from "@/lib/server/auth";
import { clearSessionCookie } from "@/lib/server/http";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ error: "Unable to sign out." }, { status: 400 });
  }
  const store = await cookies();
  await revokeSession(store.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(clearSessionCookie(request));
  return response;
}
