import "server-only";

import { readOptionalEnv } from "@/lib/server/env";

const POSTGRES_URL = /^postgres(?:ql)?:\/\//i;

export type DatabaseBoundary =
  | { configured: false; reason: string }
  | {
      configured: true;
      connected: false;
      note: "Phase 01 does not open a database connection.";
    };

/**
 * Reports whether a Postgres URL is present. It does not connect, print the
 * connection string, or claim that migrations have been applied.
 */
export function inspectDatabaseBoundary(): DatabaseBoundary {
  const url = readOptionalEnv("DATABASE_URL");
  if (!url) {
    return { configured: false, reason: "DATABASE_URL is not set" };
  }
  if (!POSTGRES_URL.test(url)) {
    return {
      configured: false,
      reason: "DATABASE_URL is not a postgres connection string",
    };
  }
  return {
    configured: true,
    connected: false,
    note: "Phase 01 does not open a database connection.",
  };
}
