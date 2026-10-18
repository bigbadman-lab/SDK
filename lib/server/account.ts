import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSession, revokeSession, type AccountIdentity } from "@/lib/server/auth";
import { isProvisionedOperator } from "@/lib/server/operator";

export { isProvisionedOperator };

export async function getCurrentAccount(): Promise<AccountIdentity | null> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (session.state !== "active") return null;
  return session.account;
}

export async function requireAccount(): Promise<AccountIdentity> {
  const account = await getCurrentAccount();
  if (!account) {
    throw new Error("Authentication required");
  }
  return account;
}

export async function currentSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function revokeCurrentSession(): Promise<void> {
  await revokeSession(await currentSessionToken());
}
