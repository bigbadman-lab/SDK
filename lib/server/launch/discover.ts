import "server-only";

import { cache } from "react";

import { toOpenLaunch, type OpenLaunch } from "@/lib/launch/post-launch";
import { selectOpenSubmission, selectVerifiedLaunches } from "@/lib/launch/registry";
import type { PublishedTokenSdk, VerifiedLaunch } from "@/lib/launch/verified-launch";
import { isPublicId } from "@/lib/library/library";
import { databaseFailure, getSql } from "@/lib/server/db";

const VERIFIED_FRESH_MS = 8_000;
const verifiedCache = new Map<string, { at: number; launches: VerifiedLaunch[] }>();

function rememberedLaunches(key: string): VerifiedLaunch[] | null {
  const hit = verifiedCache.get(key);
  if (!hit || Date.now() - hit.at > VERIFIED_FRESH_MS) return null;
  verifiedCache.delete(key);
  verifiedCache.set(key, hit);
  return hit.launches;
}

function rememberLaunches(key: string, launches: VerifiedLaunch[]): void {
  verifiedCache.delete(key);
  if (verifiedCache.size > 40) {
    const oldest = verifiedCache.keys().next().value;
    if (oldest) verifiedCache.delete(oldest);
  }
  verifiedCache.set(key, { at: Date.now(), launches });
}

const readVerifiedLaunches = cache(async (
  creator: string,
  mint: string,
): Promise<{ ok: true; launches: VerifiedLaunch[] } | { ok: false; code: "missing_schema" | "unavailable" }> => {
  const key = `${creator}\n${mint}`;
  const remembered = rememberedLaunches(key);
  if (remembered) return { ok: true, launches: remembered };
  try {
    const launches = await selectVerifiedLaunches(getSql(), {
      creator: creator || null,
      mint: mint || null,
    });
    rememberLaunches(key, launches);
    return { ok: true, launches };
  } catch (error) {
    return { ok: false, code: databaseFailure(error) === "missing_schema" ? "missing_schema" : "unavailable" };
  }
});

export function loadVerifiedLaunches(filter: {
  creator?: string | null;
  mint?: string | null;
} = {}): Promise<{ ok: true; launches: VerifiedLaunch[] } | { ok: false; code: "missing_schema" | "unavailable" }> {
  return readVerifiedLaunches(filter.creator ?? "", filter.mint ?? "");
}

function sdkInputs(value: unknown): PublishedTokenSdk["inputs"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, field]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !field || typeof field !== "object" || Array.isArray(field)) return [];
    const record = field as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "string";
    const values = type === "enum" && Array.isArray(record.values)
      ? record.values.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 80).slice(0, 40)
      : [];
    return [{ key, type, required: record.required === true, values }];
  });
}

export const loadPublishedTokenSdk = cache(async (librarySdkId: string | null): Promise<PublishedTokenSdk | null> => {
  if (!librarySdkId) return null;
  try {
    const rows = await getSql()<
      (Omit<PublishedTokenSdk, "inputs" | "versionNumber" | "versionId"> & {
        versionId: string;
        versionNumber: number | string;
        inputs: unknown;
      })[]
    >`
      select
        lib.id,
        lib.name,
        lib.description,
        lib.origin,
        lib.originator_label as "originatorLabel",
        v.id as "versionId",
        v.version_number as "versionNumber",
        v.blueprint->'inputs' as inputs
      from library_sdks lib
      join library_versions v on v.id = lib.current_version_id
      where lib.id = ${librarySdkId}
        and lib.status = 'published'
        and lib.origin in ('official', 'community')
    `;
    const row = rows[0];
    if (!row || (row.origin !== "official" && row.origin !== "community") || !isPublicId(row.versionId)) return null;
    const versionNumber = Number(row.versionNumber);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;
    return { ...row, versionNumber, inputs: sdkInputs(row.inputs) };
  } catch {
    return null;
  }
});

export async function loadOpenLaunch(accountId: string): Promise<OpenLaunch | null> {
  try {
    const row = await selectOpenSubmission(getSql(), accountId);
    return row ? toOpenLaunch(row) : null;
  } catch {
    return null;
  }
}
