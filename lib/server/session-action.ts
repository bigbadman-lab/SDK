"use server";

import { cookies, headers } from "next/headers";

import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSession } from "@/lib/server/auth";

export async function touchSession(): Promise<void> {
  const store = await cookies();
  const headerStore = await headers();
  const secure =
    headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
  if (!token || session.state === "anonymous") return;
  if (session.state === "invalid") {
    store.set(SESSION_COOKIE, "", { ...options, maxAge: 0 });
    return;
  }
  if (session.refresh) {
    store.set(SESSION_COOKIE, token, { ...options, maxAge: session.maxAge });
  }
}
