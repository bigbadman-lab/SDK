import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSession } from "@/lib/server/auth";
import { clearSessionCookie, sessionCookie } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  if (session.state !== "active" || !token) {
    const response = NextResponse.json({ authenticated: false });
    if (session.state === "invalid") {
      response.cookies.set(clearSessionCookie(request));
    }
    return response;
  }
  const response = NextResponse.json({
    authenticated: true,
    walletAddress: session.account.walletAddress,
  });
  if (session.refresh) {
    response.cookies.set(
      sessionCookie({ request, token, maxAge: session.maxAge }),
    );
  }
  return response;
}
