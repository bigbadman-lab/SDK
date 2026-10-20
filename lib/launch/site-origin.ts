export type MatchedOrigin = {
  origin: string;
  domain: string;
};

export function matchTrustedOrigin(
  header: string | null,
  host: string | null,
  configured: string | null,
): MatchedOrigin | null {
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
  if (requestOrigin.host !== host) return null;
  const local =
    requestOrigin.hostname === "localhost" || requestOrigin.hostname === "127.0.0.1";
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
