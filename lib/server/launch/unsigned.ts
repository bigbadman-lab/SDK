import "server-only";

import { randomUUID } from "node:crypto";

import { builderFailureCode, readBuilderLinkReport, type BuilderLinkReport } from "@/lib/launch/builder-probe";
import {
  BUILD_PATH,
  DIAGNOSE_PATH,
  parseUnsignedBuildRequest,
  unsignedBuildAccepted,
  type UnsignedBuildRequest,
} from "@/lib/launch/builder-request";
import { signServiceRequest } from "@/lib/launch/service-auth";
import { databaseFailure, getSql } from "@/lib/server/db";
import { requireTransactionBuilder } from "@/lib/server/env";

export async function requestUnsignedBuild(input: {
  accountId: string;
  launchId: string;
  mintPublicKey: string;
}): Promise<{ ok: true; body: unknown } | { ok: false; code: string }> {
  let idempotencyKey: string;
  try {
    const rows = await getSql()<{
      account_id: string;
      idempotency_key: string;
      status: string;
    }[]>`
      select account_id, idempotency_key, status
      from token_launches
      where id = ${input.launchId}
    `;
    const row = rows[0];
    if (!row || row.account_id !== input.accountId || row.status !== "ready_for_transaction") {
      return { ok: false, code: "not_found" };
    }
    idempotencyKey = row.idempotency_key;
  } catch (error) {
    return {
      ok: false,
      code: databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable",
    };
  }
  const request: UnsignedBuildRequest = {
    launchId: input.launchId,
    idempotencyKey,
    mintPublicKey: input.mintPublicKey,
  };
  const parsed = parseUnsignedBuildRequest(request);
  if (!parsed.ok) return parsed;
  let config: { url: string; secret: string };
  try {
    config = requireTransactionBuilder();
  } catch {
    return { ok: false, code: "builder_unconfigured" };
  }
  const body = JSON.stringify(parsed.value);
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
    if (!response.ok || !unsignedBuildAccepted(payload)) {
      return { ok: false, code: builderFailureCode(payload) };
    }
    return { ok: true, body: payload };
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
