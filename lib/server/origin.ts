import "server-only";

import { matchTrustedOrigin, type MatchedOrigin } from "@/lib/launch/site-origin";
import { readOptionalEnv } from "@/lib/server/env";

export type TrustedOrigin = MatchedOrigin;

export function trustedOrigin(request: Request): TrustedOrigin | null {
  return matchTrustedOrigin(
    request.headers.get("origin"),
    request.headers.get("host"),
    readOptionalEnv("NEXT_PUBLIC_APP_URL") ?? null,
  );
}

export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  return new URL(request.url).protocol === "https:";
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
