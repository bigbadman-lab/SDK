import "server-only";

import { activeKeySlot, API_COPY } from "@/lib/api/contract";
import type { AccountIdentity } from "@/lib/server/auth";
import { digestApiKey, generateApiKey } from "@/lib/server/api/digest";
import { ApiFlowError } from "@/lib/server/api/errors";
import { databaseFailure, getSql } from "@/lib/server/db";

export type ApiKeyRecord = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export async function listApiKeys(account: AccountIdentity): Promise<{
  active: number;
  limit: number;
  usedToday: number;
  remaining: number;
  keys: ApiKeyRecord[];
}> {
  return guard(async () => {
    const day = new Date().toISOString().slice(0, 10);
    const usage = await getSql()<{ api_runs: number }[]>`
      select api_runs from usage_daily where account_id = ${account.id} and day = ${day}
    `;
    const rows = await getSql()<
      { id: string; label: string; prefix: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }[]
    >`
      select id, label, prefix, created_at, last_used_at, revoked_at
      from api_keys
      where account_id = ${account.id} and revoked_at is null
      order by created_at desc
    `;
    const usedToday = usage[0]?.api_runs ?? 0;
    return {
      active: rows.length,
      limit: 5,
      usedToday,
      remaining: Math.max(0, 100 - usedToday),
      keys: rows.map(toRecord),
    };
  }, "keys");
}

export async function createApiKey(input: {
  account: AccountIdentity;
  label: string;
}): Promise<{ key: ApiKeyRecord & { secret: string } }> {
  const label = cleanLabel(input.label);
  const generated = newKey();
  return guard(() =>
    getSql().begin(async (tx) => {
      await tx`select id from accounts where id = ${input.account.id} for update`;
      const active = await tx<{ count: number }[]>`
        select count(*)::int as count from api_keys
        where account_id = ${input.account.id} and revoked_at is null
      `;
      if (activeKeySlot(active[0]?.count ?? 0) === "reject") throw new ApiFlowError("key_limit");
      const inserted = await tx<{ id: string; created_at: Date }[]>`
        insert into api_keys (account_id, label, prefix, key_hash)
        values (${input.account.id}, ${label}, ${generated.prefix}, ${generated.hash})
        returning id, created_at
      `;
      const row = inserted[0];
      if (!row) throw new ApiFlowError("unavailable", null, API_COPY.keysUnavailable);
      return {
        key: {
          id: row.id,
          label,
          prefix: generated.prefix,
          secret: generated.secret,
          createdAt: row.created_at.toISOString(),
          lastUsedAt: null,
          revokedAt: null,
        },
      };
    }),
    "keys",
  );
}

export async function revokeApiKey(input: { account: AccountIdentity; keyId: string }): Promise<ApiKeyRecord> {
  if (!isUuid(input.keyId)) throw new ApiFlowError("key_not_found");
  return guard(async () => {
    const rows = await getSql()<{ id: string; label: string; prefix: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }[]>`
      update api_keys
      set revoked_at = coalesce(revoked_at, now())
      where id = ${input.keyId} and account_id = ${input.account.id}
      returning id, label, prefix, created_at, last_used_at, revoked_at
    `;
    const row = rows[0];
    if (!row) throw new ApiFlowError("key_not_found");
    return toRecord(row);
  }, "keys");
}

export async function replaceApiKey(input: {
  account: AccountIdentity;
  keyId: string;
  label: string;
}): Promise<{ key: ApiKeyRecord & { secret: string } }> {
  if (!isUuid(input.keyId)) throw new ApiFlowError("key_not_found");
  const label = cleanLabel(input.label);
  const generated = newKey();
  return guard(() =>
    getSql().begin(async (tx) => {
      await tx`select id from accounts where id = ${input.account.id} for update`;
      const current = await tx<{ id: string; revoked_at: Date | null }[]>`
        select id, revoked_at from api_keys
        where id = ${input.keyId} and account_id = ${input.account.id}
        for update
      `;
      const existing = current[0];
      if (!existing) throw new ApiFlowError("key_not_found");
      if (existing.revoked_at) throw new ApiFlowError("revoked_api_key");
      await tx`update api_keys set revoked_at = now() where id = ${existing.id}`;
      const inserted = await tx<{ id: string; created_at: Date }[]>`
        insert into api_keys (account_id, label, prefix, key_hash)
        values (${input.account.id}, ${label}, ${generated.prefix}, ${generated.hash})
        returning id, created_at
      `;
      const row = inserted[0];
      if (!row) throw new ApiFlowError("unavailable", null, API_COPY.keysUnavailable);
      return {
        key: {
          id: row.id,
          label,
          prefix: generated.prefix,
          secret: generated.secret,
          createdAt: row.created_at.toISOString(),
          lastUsedAt: null,
          revokedAt: null,
        },
      };
    }),
    "keys",
  );
}

export async function accountForApiKey(secret: string): Promise<{ keyId: string; accountId: string }> {
  let hash = "";
  try {
    hash = digestApiKey(secret);
  } catch {
    throw new ApiFlowError("unavailable");
  }
  return guard(async () => {
    const rows = await getSql()<{ id: string; account_id: string; revoked_at: Date | null }[]>`
      select id, account_id, revoked_at from api_keys where key_hash = ${hash}
    `;
    const row = rows[0];
    if (!row) throw new ApiFlowError("invalid_api_key");
    if (row.revoked_at) throw new ApiFlowError("revoked_api_key");
    return { keyId: row.id, accountId: row.account_id };
  });
}

function newKey(): { secret: string; prefix: string; hash: string } {
  try {
    return generateApiKey();
  } catch {
    throw new ApiFlowError("unavailable", null, API_COPY.keysUnavailable);
  }
}

function cleanLabel(value: string): string {
  const label = value.trim();
  if (label.length < 1 || label.length > 80) throw new ApiFlowError("invalid_input", null, API_COPY.keyLabel);
  return label;
}

function toRecord(row: {
  id: string;
  label: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}): ApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    prefix: row.prefix,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function guard<T>(work: () => Promise<T>, surface: "run" | "keys" = "run"): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiFlowError) throw error;
    const code = databaseFailure(error) === "missing_schema" ? "unavailable" : "internal_error";
    if (surface === "keys") {
      throw new ApiFlowError(code, null, code === "unavailable" ? API_COPY.keysUnavailable : API_COPY.keysInternal);
    }
    throw new ApiFlowError(code);
  }
}
