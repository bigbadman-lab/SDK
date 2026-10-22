import "server-only";

import { toOpenLaunch, type OpenLaunch } from "@/lib/launch/post-launch";
import { selectOpenSubmission, selectVerifiedLaunches } from "@/lib/launch/registry";
import type { PublishedTokenSdk, VerifiedLaunch } from "@/lib/launch/verified-launch";
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

function sdkInputs(value: unknown): PublishedTokenSdk["inputs"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, field]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !field || typeof field !== "object" || Array.isArray(field)) return [];
    const record = field as Record<string, unknown>;
    return [{
      key,
      type: typeof record.type === "string" ? record.type : "string",
      required: record.required === true,
    }];
  });
}

export async function loadPublishedTokenSdk(librarySdkId: string | null): Promise<PublishedTokenSdk | null> {
  if (!librarySdkId) return null;
  try {
    const rows = await getSql()<
      (Omit<PublishedTokenSdk, "inputs" | "versionNumber"> & { versionNumber: number | string; inputs: unknown })[]
    >`
      select
        lib.id,
        lib.name,
        lib.description,
        lib.origin,
        lib.originator_label as "originatorLabel",
        v.version_number as "versionNumber",
        v.blueprint->'inputs' as inputs
      from library_sdks lib
      join library_versions v on v.id = lib.current_version_id
      where lib.id = ${librarySdkId}
        and lib.status = 'published'
        and lib.origin in ('official', 'community')
    `;
    const row = rows[0];
    if (!row || (row.origin !== "official" && row.origin !== "community")) return null;
    const versionNumber = Number(row.versionNumber);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;
    return { ...row, versionNumber, inputs: sdkInputs(row.inputs) };
  } catch {
    return null;
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
