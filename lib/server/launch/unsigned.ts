import "server-only";

import { randomUUID } from "node:crypto";

import { builderFailureCode, readBuilderLinkReport, type BuilderLinkReport } from "@/lib/launch/builder-probe";
import {
  BUILD_PATH,
  DIAGNOSE_PATH,
  PARENT_PATH,
  parseParentObservationRequest,
  parseRehearsalBuildRequest,
  parseUnsignedBuildRequest,
  unsignedBuildAccepted,
  type UnsignedBuildRequest,
} from "@/lib/launch/builder-request";
import { parseParentObservation, type ParentObservation } from "@/lib/launch/parent";
import { signServiceRequest } from "@/lib/launch/service-auth";
import { PLATFORM_FEE_WALLET } from "@/lib/launch/fees";
import { acceptCanonicalLaunchParent } from "@/lib/launch/production-parent";
import { canReleaseUnsignedMint } from "@/lib/launch/rehearsal-flow";
import { databaseFailure, getSql } from "@/lib/server/db";
import { requireTransactionBuilder } from "@/lib/server/env";
import { readPublicLaunchGate } from "@/lib/server/launch/gate";

export async function requestUnsignedBuild(input: {
  accountId: string;
  launchId: string;
  mintPublicKey: string;
}): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; code: string }> {
  const gate = await readPublicLaunchGate();
  if (!gate.open) return { ok: false, code: gate.availability === "unavailable" ? "unavailable" : "closed" };
  const sql = getSql();
  let idempotencyKey: string;
  try {
    const rows = await sql<{
      account_id: string;
      idempotency_key: string;
      status: string;
      parent_scope: string;
      parent_mint_address: string | null;
    }[]>`
      select account_id, idempotency_key, status, parent_scope, parent_mint_address
      from token_launches
      where id = ${input.launchId}
    `;
    const row = rows[0];
    if (!row || row.account_id !== input.accountId || row.status !== "ready_for_transaction") {
      return { ok: false, code: "not_found" };
    }
    if (row.parent_scope !== "production" || row.parent_mint_address !== null) {
      return { ok: false, code: "parent_scope" };
    }
    idempotencyKey = row.idempotency_key;
  } catch (error) {
    return {
      ok: false,
      code: databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable",
    };
  }
  const parsed = parseUnsignedBuildRequest({
    launchId: input.launchId,
    idempotencyKey,
    mintPublicKey: input.mintPublicKey,
  });
  if (!parsed.ok) return parsed;
  const posted = await postBuild(parsed.value, false);
  if (!posted.ok) return posted;
  try {
    const builds = await sql<{
      id: string;
      parent_mint_address: string;
      mint_address: string;
      message_hash: string;
      blockhash: string;
      transaction: string;
      buy_amount: string;
      shareholders: unknown;
      expires_at: Date;
    }[]>`
      select id, parent_mint_address, mint_address, message_hash, blockhash, transaction, buy_amount, shareholders, expires_at
      from launch_builds
      where launch_id = ${input.launchId} and account_id = ${input.accountId} and mint_address = ${input.mintPublicKey}
      order by created_at desc
      limit 1
    `;
    const build = builds[0];
    const configs = await sql<{
      mint_address: string | null;
      token_program: string | null;
      decimals: number | null;
    }[]>`
      select mint_address, token_program, decimals
      from sdk_parent_config
      where id = 1
    `;
    const config = configs[0];
    if (!build || !config?.mint_address) return { ok: false, code: "parent_unregistered" };
    const observed = await requestParentObservation(config.mint_address);
    if (!observed.ok) {
      return { ok: false, code: observed.code === "builder_rejected" ? "parent_ineligible" : observed.code };
    }
    const accepted = acceptCanonicalLaunchParent({
      configMint: config.mint_address,
      configProgram: config.token_program,
      configDecimals: config.decimals,
      observed: observed.observation,
      buildParentMint: build.parent_mint_address,
    });
    if (!accepted.ok) return accepted;
    const current = await readPublicLaunchGate();
    if (!current.open || current.mint !== accepted.mint) {
      return { ok: false, code: current.availability === "unavailable" ? "unavailable" : "closed" };
    }
    await sql`
      insert into launch_approvals (launch_id, build_id, parent_mint_address, scope, approver_wallet)
      values (${input.launchId}, ${build.id}, ${accepted.mint}, 'production', ${PLATFORM_FEE_WALLET})
      on conflict (launch_id, build_id) do nothing
    `;
    await sql`
      update token_launches
      set attempt_status = 'ready_to_sign',
          attempt_mint_address = ${build.mint_address},
          attempt_message_hash = ${build.message_hash}
      where id = ${input.launchId}
        and account_id = ${input.accountId}
        and parent_scope = 'production'
        and parent_mint_address is null
        and (attempt_mint_address is null or attempt_mint_address = ${build.mint_address})
    `;
    return {
      ok: true,
      body: {
        ok: true,
        buildId: build.id,
        launchId: input.launchId,
        parentMint: accepted.mint,
        childMint: build.mint_address,
        messageHash: build.message_hash,
        blockhash: build.blockhash,
        expiresAt: new Date(build.expires_at).toISOString(),
        transaction: build.transaction,
        buyAmount: build.buy_amount,
        shareholders: build.shareholders,
        authorized: false,
        sigVerify: false,
        coverage: "live",
        transactionVersion: 1,
        encoding: "base64",
      },
    };
  } catch (error) {
    return { ok: false, code: databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
}

export async function rehearsalBoundMint(input: {
  accountId: string;
  launchId: string;
}): Promise<{ ok: true; boundMint: string | null } | { ok: false; code: string }> {
  const sql = getSql();
  try {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'token_launches'
        and column_name in ('parent_scope', 'attempt_mint_address')
    `;
    if (columns.length < 2) return { ok: false, code: "not_ready" };
    const rows = await sql<{ attempt_mint_address: string | null; account_id: string }[]>`
      select account_id, attempt_mint_address from token_launches where id = ${input.launchId}
    `;
    const row = rows[0];
    if (!row || row.account_id !== input.accountId) return { ok: false, code: "not_found" };
    return { ok: true, boundMint: row.attempt_mint_address };
  } catch (error) {
    return { ok: false, code: databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
}

export async function requestRehearsalBuild(input: {
  accountId: string;
  launchId: string;
  mintPublicKey: string;
}): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; code: string }> {
  const sql = getSql();
  try {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'token_launches'
        and column_name in ('parent_scope', 'parent_mint_address', 'attempt_status', 'attempt_mint_address')
    `;
    if (columns.length < 4) return { ok: false, code: "not_ready" };
    const launches = await sql<{
      account_id: string;
      idempotency_key: string;
      status: string;
      parent_scope: string;
      parent_mint_address: string | null;
      attempt_mint_address: string | null;
      attempt_status: string;
    }[]>`
      select account_id, idempotency_key, status, parent_scope, parent_mint_address, attempt_mint_address, attempt_status
      from token_launches
      where id = ${input.launchId}
    `;
    const launch = launches[0];
    if (!launch || launch.account_id !== input.accountId || launch.status !== "ready_for_transaction") {
      return { ok: false, code: "not_found" };
    }
    if (launch.parent_scope !== "test" || !launch.parent_mint_address) return { ok: false, code: "parent_scope" };
    let parents: { mint_address: string }[];
    try {
      parents = await sql<{ mint_address: string }[]>`
        select mint_address from parent_registrations
        where scope = 'test' and symbol = 'TREST' and eligible = true and mint_address = ${launch.parent_mint_address}
        limit 1
      `;
    } catch (error) {
      return { ok: false, code: databaseFailure(error) === "missing_schema" ? "parent_unregistered" : "unavailable" };
    }
    if (!parents[0]) return { ok: false, code: "parent_unregistered" };
    const open = await sql<{ mint_address: string; status: string }[]>`
      select mint_address, status from launch_builds
      where launch_id = ${input.launchId} and account_id = ${input.accountId}
      order by created_at desc
    `;
    const pinnedElsewhere = launch.attempt_mint_address !== null && launch.attempt_mint_address !== input.mintPublicKey;
    const builtElsewhere = open.some((row) => row.mint_address !== input.mintPublicKey);
    if (pinnedElsewhere || builtElsewhere) {
      const submissions = await sql<{ present: boolean }[]>`
        select to_regclass('public.launch_submissions') is not null as present
      `;
      const submitted = submissions[0]?.present
        ? (await sql<{ id: string }[]>`
            select id from launch_submissions where launch_id = ${input.launchId} limit 1
          `).length > 0
        : false;
      if (!canReleaseUnsignedMint({
        scope: launch.parent_scope,
        attemptStatus: launch.attempt_status,
        buildStatuses: open.map((row) => row.status),
        submitted,
      })) {
        return { ok: false, code: "mint_conflict" };
      }
      const approvals = await sql<{ present: boolean }[]>`
        select to_regclass('public.launch_approvals') is not null as present
      `;
      await sql.begin(async (tx) => {
        if (approvals[0]?.present) {
          await tx`delete from launch_approvals where launch_id = ${input.launchId}`;
        }
        await tx`
          delete from launch_builds
          where launch_id = ${input.launchId}
            and account_id = ${input.accountId}
            and status in ('built', 'expired', 'invalidated')
        `;
        const cleared = await tx<{ id: string }[]>`
          update token_launches
          set attempt_status = 'ready_for_transaction',
              attempt_mint_address = null,
              attempt_message_hash = null
          where id = ${input.launchId}
            and account_id = ${input.accountId}
            and attempt_status = ${launch.attempt_status}
          returning id
        `;
        if (cleared.length !== 1) throw new Error("unsigned mint release was not applied");
      });
    }
    const rehearsal = parseRehearsalBuildRequest({
      launchId: input.launchId,
      idempotencyKey: launch.idempotency_key,
      mintPublicKey: input.mintPublicKey,
      scope: "test",
    });
    if (!rehearsal.ok) return rehearsal;
    const posted = await postBuild(rehearsal.value, true);
    if (!posted.ok) return posted;
    const rows = await sql<{
      id: string;
      parent_mint_address: string;
      mint_address: string;
      message_hash: string;
      blockhash: string;
      transaction: string;
      buy_amount: string;
      shareholders: unknown;
      expires_at: Date;
    }[]>`
      select id, parent_mint_address, mint_address, message_hash, blockhash, transaction, buy_amount, shareholders, expires_at
      from launch_builds
      where launch_id = ${input.launchId} and account_id = ${input.accountId} and mint_address = ${input.mintPublicKey}
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    if (!row || row.parent_mint_address !== launch.parent_mint_address) return { ok: false, code: "unavailable" };
    await sql`
      update token_launches
      set attempt_status = 'ready_to_sign',
          attempt_mint_address = ${row.mint_address},
          attempt_message_hash = ${row.message_hash}
      where id = ${input.launchId}
        and account_id = ${input.accountId}
        and (attempt_mint_address is null or attempt_mint_address = ${row.mint_address})
    `;
    return {
      ok: true,
      body: {
        ok: true,
        buildId: row.id,
        launchId: input.launchId,
        parentMint: row.parent_mint_address,
        childMint: row.mint_address,
        messageHash: row.message_hash,
        blockhash: row.blockhash,
        expiresAt: new Date(row.expires_at).toISOString(),
        transaction: row.transaction,
        buyAmount: row.buy_amount,
        shareholders: row.shareholders,
        authorized: false,
      },
    };
  } catch (error) {
    return { ok: false, code: databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
}

async function postBuild(
  value: UnsignedBuildRequest,
  rehearsal: boolean,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const body = JSON.stringify(rehearsal ? { ...value, scope: "test" } : value);
  let config: { url: string; secret: string };
  try {
    config = requireTransactionBuilder();
  } catch {
    return { ok: false, code: "builder_unconfigured" };
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const signature = signServiceRequest({
    secret: config.secret,
    timestamp,
    nonce,
    method: "POST",
    path: BUILD_PATH,
    body,
  });
  try {
    const response = await fetch(new URL(BUILD_PATH, config.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sdk-timestamp": timestamp,
        "x-sdk-nonce": nonce,
        "x-sdk-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !unsignedBuildAccepted(payload)) return { ok: false, code: builderFailureCode(payload) };
    return { ok: true };
  } catch {
    return { ok: false, code: "builder_rejected" };
  }
}

export async function requestParentObservation(
  mint: string,
): Promise<{ ok: true; observation: ParentObservation } | { ok: false; code: string }> {
  const parsed = parseParentObservationRequest({ mint });
  if (!parsed.ok) return parsed;
  let config: { url: string; secret: string };
  try {
    config = requireTransactionBuilder();
  } catch {
    return { ok: false, code: "builder_unconfigured" };
  }
  const body = JSON.stringify({ mint: parsed.mint });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const signature = signServiceRequest({
    secret: config.secret,
    timestamp,
    nonce,
    method: "POST",
    path: PARENT_PATH,
    body,
  });
  try {
    const response = await fetch(new URL(PARENT_PATH, config.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sdk-timestamp": timestamp,
        "x-sdk-nonce": nonce,
        "x-sdk-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const code =
        payload && typeof payload === "object" && "code" in payload ? String((payload as { code: unknown }).code) : "";
      if (code === "parent_ineligible" || code === "unavailable" || code === "body") return { ok: false, code };
      return { ok: false, code: "builder_rejected" };
    }
    if (!payload || typeof payload !== "object" || !("observation" in payload)) {
      return { ok: false, code: "builder_rejected" };
    }
    const observation = parseParentObservation((payload as { observation: unknown }).observation);
    return observation.ok ? observation : { ok: false, code: "builder_rejected" };
  } catch {
    return { ok: false, code: "builder_rejected" };
  }
}

export async function probeTransactionBuilder(): Promise<
  { ok: true; report: BuilderLinkReport } | { ok: false; code: "builder_unconfigured" | "builder_rejected" }
> {
  let config: { url: string; secret: string };
  try {
    config = requireTransactionBuilder();
  } catch {
    return { ok: false, code: "builder_unconfigured" };
  }
  const body = "{}";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const signature = signServiceRequest({
    secret: config.secret,
    timestamp,
    nonce,
    method: "POST",
    path: DIAGNOSE_PATH,
    body,
  });
  try {
    const response = await fetch(new URL(DIAGNOSE_PATH, config.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sdk-timestamp": timestamp,
        "x-sdk-nonce": nonce,
        "x-sdk-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) return { ok: false, code: "builder_rejected" };
    return readBuilderLinkReport(payload);
  } catch {
    return { ok: false, code: "builder_rejected" };
  }
}
