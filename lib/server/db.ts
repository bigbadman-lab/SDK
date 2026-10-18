import "server-only";

import postgres from "postgres";

import { requireDatabaseUrl } from "@/lib/server/env";

type Sql = ReturnType<typeof postgres>;

let client: Sql | undefined;

function sslMode(url: string): "require" | false {
  try {
    const hostname = new URL(url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  } catch {
    return "require";
  }
  return "require";
}

export function getSql(): Sql {
  if (!client) {
    const url = requireDatabaseUrl();
    client = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: sslMode(url),
    });
  }
  return client;
}

export function databaseFailure(error: unknown): "missing_schema" | "unavailable" {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "42P01" || code === "42703" || code === "3F000") {
    return "missing_schema";
  }
  return "unavailable";
}
