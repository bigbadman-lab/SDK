import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";
import { AuthFlowError } from "@/lib/server/auth";
import { requestIsSecure } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export function authError(error: unknown): NextResponse {
  if (error instanceof AuthFlowError) {
    console.error(`[auth] ${error.code}`);
    const message =
      error.status === 429
        ? "Too many requests."
        : error.status === 503
          ? "Sign-in is unavailable."
          : "Unable to sign in.";
    return NextResponse.json({ error: message }, { status: error.status });
  }
  console.error("[auth] unexpected");
  return NextResponse.json(
    { error: "Sign-in is unavailable." },
    { status: 503 },
  );
}

export function sessionCookie(input: {
  request: Request;
  token: string;
  maxAge: number;
}): {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    name: SESSION_COOKIE,
    value: input.token,
    httpOnly: true,
    secure: requestIsSecure(input.request),
    sameSite: "lax",
    path: "/",
    maxAge: input.maxAge,
  };
}

export function clearSessionCookie(request: Request) {
  return { ...sessionCookie({ request, token: "", maxAge: 0 }) };
}
