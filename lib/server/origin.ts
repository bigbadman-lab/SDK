import "server-only";

import { readOptionalEnv } from "@/lib/server/env";

export type TrustedOrigin = {
  origin: string;
  domain: string;
};

export function trustedOrigin(request: Request): TrustedOrigin | null {
  const header = request.headers.get("origin");
  if (!header) return null;
  let requestOrigin: URL;
  try {
    requestOrigin = new URL(header);
  } catch {
    return null;
  }
  if (requestOrigin.protocol !== "http:" && requestOrigin.protocol !== "https:") {
    return null;
  }
  const host = request.headers.get("host");
  if (requestOrigin.host !== host) return null;
  const local =
    requestOrigin.hostname === "localhost" ||
    requestOrigin.hostname === "127.0.0.1";
  const configured = readOptionalEnv("NEXT_PUBLIC_APP_URL");
  if (configured) {
    try {
      const expected = new URL(configured);
      if (requestOrigin.origin !== expected.origin && !local) return null;
    } catch {
      if (!local) return null;
    }
  }
  return { origin: requestOrigin.origin, domain: requestOrigin.host };
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
