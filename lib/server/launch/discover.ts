import "server-only";

import { toOpenLaunch, type OpenLaunch } from "@/lib/launch/post-launch";
import { selectOpenSubmission, selectVerifiedLaunches } from "@/lib/launch/registry";
import type { VerifiedLaunch } from "@/lib/launch/verified-launch";
import { databaseFailure, getSql } from "@/lib/server/db";

export async function loadVerifiedLaunches(filter: {
  creator?: string | null;
  mint?: string | null;
} = {}): Promise<{ ok: true; launches: VerifiedLaunch[] } | { ok: false; code: "missing_schema" | "unavailable" }> {
  try {
    return { ok: true, launches: await selectVerifiedLaunches(getSql(), filter) };
  } catch (error) {
    return { ok: false, code: databaseFailure(error) === "missing_schema" ? "missing_schema" : "unavailable" };
  }
}

export async function loadOpenLaunch(accountId: string): Promise<OpenLaunch | null> {
  try {
    const row = await selectOpenSubmission(getSql(), accountId);
    return row ? toOpenLaunch(row) : null;
  } catch {
    return null;
  }
}
