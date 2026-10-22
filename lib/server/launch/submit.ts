import "server-only";

import { writeSubmission } from "@/lib/launch/registry";
import { noteBroadcast, noteVerification, type SubmissionIntent } from "@/lib/launch/submission";
import { verificationStamp, type VerificationStamp } from "@/lib/launch/verified-launch";
import { openWire, sealWire } from "@/lib/launch/wire";
import { verifyLaunchEvidence, type LaunchEvidence } from "@/lib/launch/chain-evidence";
import { broadcastSignedTransaction, type BroadcastOutcome } from "@/lib/launch/broadcast";
import {
  approvalMatches,
  planRecovery,
  planSubmission,
  type LaunchApproval,
  type StoredLaunchBuild,
} from "@/lib/launch/submit-plan";
import { EVIDENCE_PATH } from "@/lib/launch/builder-request";
import { signServiceRequest } from "@/lib/launch/service-auth";
import { databaseFailure, getSql } from "@/lib/server/db";
import { requireTransactionBuilder } from "@/lib/server/env";

type Sql = ReturnType<typeof getSql>;

const CHILD_TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function wireKey(): Uint8Array | null {
  const raw = process.env.LAUNCH_WIRE_KEY?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

function schemaCode(error: unknown): "missing_schema" | "unavailable" {
  return databaseFailure(error);
}

async function productionParent(sql: Sql): Promise<string | null> {
  const rows = await sql<{ mint_address: string | null }[]>`
    select mint_address from sdk_parent_config where id = 1
  `;
  return rows[0]?.mint_address ?? null;
}

function shareholdersOf(value: unknown): StoredLaunchBuild["shareholders"] | null {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) return null;
  const rows = parsed.map((row) => {
    if (!row || typeof row !== "object") return null;
    const record = row as { address?: unknown; shareBps?: unknown };
    if (typeof record.address !== "string" || typeof record.shareBps !== "number") return null;
    return { address: record.address, shareBps: record.shareBps };
  });
  if (rows.some((row) => row === null)) return null;
  return rows as StoredLaunchBuild["shareholders"];
}

async function loadBuild(sql: Sql, accountId: string, launchId: string, buildId: string): Promise<(StoredLaunchBuild & { unsignedTransaction: Uint8Array }) | null> {
  const rows = await sql<{
    launch_id: string;
    build_id: string;
    account_id: string;
    wallet_address: string;
    mint_address: string;
    parent_mint_address: string;
    parent_scope: "production" | "test";
    launch_parent: string | null;
    message_hash: string;
    blockhash: string;
    expires_at: string | number;
    metadata_uri: string;
    buy_amount: string;
    shareholders: unknown;
    fee_category: StoredLaunchBuild["category"];
    originator_wallet: string | null;
    status: StoredLaunchBuild["status"];
    unsigned_transaction: string;
  }[]>`
    select
      b.launch_id,
      b.id as build_id,
      b.account_id,
      b.wallet_address,
      b.mint_address,
      b.parent_mint_address,
      l.parent_scope,
      l.parent_mint_address as launch_parent,
      b.message_hash,
      b.blockhash,
      floor(extract(epoch from b.expires_at) * 1000) as expires_at,
      b.metadata_uri,
      b.buy_amount,
      b.shareholders,
      b.fee_category,
      o.wallet_address as originator_wallet,
      b.status,
      b.transaction as unsigned_transaction
    from launch_builds b
    join token_launches l on l.id = b.launch_id
    left join accounts o on o.id = l.originator_account_id
    where b.id = ${buildId} and b.launch_id = ${launchId} and b.account_id = ${accountId}
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.parent_scope === "test" && row.launch_parent !== row.parent_mint_address) return null;
  if (row.parent_scope === "production" && row.launch_parent !== null) return null;
  const shareholders = shareholdersOf(row.shareholders);
  if (!shareholders) return null;
  const registered = await productionParent(sql);
  return {
    launchId: row.launch_id,
    buildId: row.build_id,
    accountId: row.account_id,
    wallet: row.wallet_address,
    childMint: row.mint_address,
    parentMint: row.parent_mint_address,
    scope: row.parent_scope,
    messageHash: row.message_hash,
    blockhash: row.blockhash,
    expiresAt: Number(row.expires_at),
    metadataUri: row.metadata_uri,
    buyAmount: row.buy_amount,
    shareholders,
    category: row.fee_category,
    originatorWallet: row.originator_wallet,
    productionParentRegistered: registered !== null && registered === row.parent_mint_address,
    status: row.status,
    unsignedTransaction: Uint8Array.from(Buffer.from(row.unsigned_transaction, "base64")),
  };
}

async function loadSubmission(sql: Sql, launchId: string): Promise<SubmissionIntent | null> {
  const rows = await sql<{
    launch_id: string;
    build_id: string;
    child_mint_address: string;
    parent_mint_address: string;
    scope: "production" | "test";
    wallet_address: string;
    signature: string;
    message_hash: string;
    status: SubmissionIntent["status"];
    wire_ciphertext: string | null;
    slot: string | null;
    verified_at: Date | null;
  }[]>`
    select launch_id, build_id, child_mint_address, parent_mint_address, scope, wallet_address,
      signature, message_hash, status, wire_ciphertext, slot::text as slot, verified_at
    from launch_submissions
    where launch_id = ${launchId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    launchId: row.launch_id,
    buildId: row.build_id,
    childMint: row.child_mint_address,
    parentMint: row.parent_mint_address,
    scope: row.scope,
    wallet: row.wallet_address,
    signature: row.signature,
    messageHash: row.message_hash,
    status: row.status,
    wireRetained: row.wire_ciphertext !== null,
    slot: row.slot,
    verifiedAtMs: row.verified_at ? new Date(row.verified_at).getTime() : null,
  };
}

async function loadApproval(sql: Sql, launchId: string, buildId: string): Promise<LaunchApproval | null> {
  try {
    const rows = await sql<LaunchApproval[]>`
      select launch_id as "launchId", build_id as "buildId", parent_mint_address as "parentMint", scope
      from launch_approvals
      where launch_id = ${launchId} and build_id = ${buildId}
    `;
    return rows[0] ?? null;
  } catch (error) {
    if (schemaCode(error) === "missing_schema") return null;
    throw error;
  }
}

function stampedIntent(intent: SubmissionIntent, evidenceSlot: string | null, nowMs: number): {
  intent: SubmissionIntent;
  stamp: VerificationStamp;
} {
  const stamp = verificationStamp({
    status: intent.status,
    evidenceSlot,
    nowMs,
    storedSlot: intent.slot ?? null,
    storedVerifiedAtMs: intent.verifiedAtMs ?? null,
  });
  return {
    stamp,
    intent: { ...intent, status: stamp.status, slot: stamp.slot, verifiedAtMs: stamp.verifiedAtMs },
  };
}

async function saveSubmission(
  sql: Sql,
  intent: SubmissionIntent,
  accountId: string,
  ciphertext: string,
  stamp: VerificationStamp,
): Promise<"ok" | "conflict"> {
  return writeSubmission(sql, { intent, accountId, ciphertext, stamp });
}

async function rpcSend(wire: Uint8Array): Promise<BroadcastOutcome> {
  const url = process.env.HELIUS_RPC_URL?.trim();
  if (!url) return "unknown";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [Buffer.from(wire).toString("base64"), { encoding: "base64", skipPreflight: false, maxRetries: 0 }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { error?: unknown; result?: unknown };
    if (body.error) return "rejected";
    return typeof body.result === "string" ? "accepted" : "unknown";
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : "unknown";
  }
}

export async function submitSignedLaunch(input: {
  accountId: string;
  launchId: string;
  buildId: string;
  transaction: Uint8Array;
}): Promise<{ ok: true; status: string; broadcast: boolean; signature: string } | { ok: false; code: string }> {
  const sql = getSql();
  let build: (StoredLaunchBuild & { unsignedTransaction: Uint8Array }) | null;
  let existing: SubmissionIntent | null;
  try {
    build = await loadBuild(sql, input.accountId, input.launchId, input.buildId);
    existing = build ? await loadSubmission(sql, build.launchId) : null;
  } catch (error) {
    return { ok: false, code: schemaCode(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
  const key = wireKey();
  const approval = build ? await loadApproval(sql, build.launchId, build.buildId).catch(() => null) : null;
  const plan = await planSubmission({
    accountId: input.accountId,
    build,
    transaction: input.transaction,
    now: Date.now(),
    existing,
    approval,
    wireKeyPresent: key !== null,
    ...(build ? { committedTransaction: build.unsignedTransaction } : {}),
  });
  if (!plan.ok) return plan;
  const sealed = sealWire(input.transaction, key);
  if (!sealed.ok || !sealed.retained) return { ok: false, code: "wire_key" };
  const pending = stampedIntent(plan.intent, null, Date.now());
  try {
    const saved = await saveSubmission(sql, pending.intent, input.accountId, sealed.ciphertext, pending.stamp);
    if (saved === "conflict") return { ok: false, code: "conflict" };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "23505") return { ok: false, code: "conflict" };
    return { ok: false, code: schemaCode(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
  if (plan.broadcast !== "send" || !build || !approvalMatches(build, approval)) {
    return { ok: true, status: pending.intent.status, broadcast: false, signature: plan.intent.signature };
  }
  const sent = await broadcastSignedTransaction({ wire: input.transaction, authorised: true, rpc: rpcSend });
  const outcome = sent.ok ? sent.outcome : "unknown";
  const next = stampedIntent(noteBroadcast(pending.intent, outcome), null, Date.now());
  try {
    await saveSubmission(sql, next.intent, input.accountId, sealed.ciphertext, next.stamp);
  } catch {
    return { ok: true, status: "uncertain", broadcast: true, signature: plan.intent.signature };
  }
  return { ok: true, status: next.intent.status, broadcast: true, signature: next.intent.signature };
}

async function readChain(signature: string, childMint: string): Promise<{
  evidence: LaunchEvidence | null;
  observed: "confirmed" | "failed" | "missing" | "uncertain" | null;
}> {
  try {
    const config = requireTransactionBuilder();
    const body = JSON.stringify({ childMint, signature });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
    const signatureHeader = signServiceRequest({
      secret: config.secret,
      timestamp,
      nonce,
      method: "POST",
      path: EVIDENCE_PATH,
      body,
    });
    const response = await fetch(new URL(EVIDENCE_PATH, config.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sdk-timestamp": timestamp,
        "x-sdk-nonce": nonce,
        "x-sdk-signature": signatureHeader,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { evidence: null, observed: null };
    const payload = (await response.json()) as { evidence?: LaunchEvidence };
    const evidence = payload.evidence ?? null;
    const observed = evidence?.transactionStatus;
    if (observed !== "confirmed" && observed !== "failed" && observed !== "missing" && observed !== "uncertain") {
      return { evidence: null, observed: null };
    }
    return { evidence, observed };
  } catch {
    return { evidence: null, observed: null };
  }
}

export async function recoverSignedLaunch(input: {
  accountId: string;
  launchId: string;
}): Promise<{ ok: true; status: string; broadcast: boolean; signature: string; childMint: string; parentMint: string; buyAmount: string; shareholders: StoredLaunchBuild["shareholders"] } | { ok: false; code: string }> {
  const sql = getSql();
  let existing: SubmissionIntent | null;
  let build: StoredLaunchBuild | null = null;
  try {
    existing = await loadSubmission(sql, input.launchId);
    if (existing) {
      const rows = await sql<{ build_id: string; account_id: string }[]>`
        select build_id, account_id from launch_submissions where launch_id = ${input.launchId}
      `;
      const row = rows[0];
      if (!row || row.account_id !== input.accountId) return { ok: false, code: "forbidden" };
      build = await loadBuild(sql, input.accountId, input.launchId, row.build_id);
    }
  } catch (error) {
    return { ok: false, code: schemaCode(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
  if (!existing || !build) return { ok: false, code: "not_found" };
  const chain = await readChain(existing.signature, existing.childMint);
  const approval = await loadApproval(sql, existing.launchId, existing.buildId).catch(() => null);
  const recovery = planRecovery({
    existing,
    observed: chain.observed,
    blockhashExpired: false,
    approvalMatches: approvalMatches(build, approval),
    wireRetained: existing.wireRetained,
  });
  if (!recovery.ok) return recovery;
  let intent = recovery.intent;
  if (intent.status === "verifying" && chain.evidence) {
    const verdict = verifyLaunchEvidence(
      {
        childMint: build.childMint,
        parentMint: build.parentMint,
        launcher: build.wallet,
        tokenProgram: CHILD_TOKEN_PROGRAM,
        metadataUri: build.metadataUri,
        buyAmount: build.buyAmount,
        shareholders: build.shareholders,
      },
      chain.evidence,
    );
    intent = noteVerification(intent, verdict);
  }
  const key = wireKey();
  if (recovery.action === "rebroadcast") {
    if (!key) return { ok: false, code: "wire_key" };
    const opened = await openStoredWire(sql, existing.launchId, key);
    if (!opened.ok) return { ok: false, code: "wire_key" };
    const sent = await broadcastSignedTransaction({ wire: opened.wire, authorised: true, rpc: rpcSend });
    intent = noteBroadcast(intent, sent.ok ? sent.outcome : "unknown");
  }
  const stamped = stampedIntent(intent, chain.evidence?.slot ?? null, Date.now());
  try {
    const ciphertext = await currentCiphertext(sql, existing.launchId);
    if (ciphertext) {
      const saved = await saveSubmission(sql, stamped.intent, input.accountId, ciphertext, stamped.stamp);
      if (saved === "conflict") return { ok: false, code: "conflict" };
    }
  } catch (error) {
    return { ok: false, code: schemaCode(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
  return { ok: true, status: stamped.intent.status, broadcast: recovery.action === "rebroadcast", signature: intent.signature, childMint: build.childMint, parentMint: build.parentMint, buyAmount: build.buyAmount, shareholders: build.shareholders };
}

async function currentCiphertext(sql: Sql, launchId: string): Promise<string | null> {
  const rows = await sql<{ wire_ciphertext: string | null }[]>`
    select wire_ciphertext from launch_submissions where launch_id = ${launchId}
  `;
  return rows[0]?.wire_ciphertext ?? null;
}

async function openStoredWire(sql: Sql, launchId: string, key: Uint8Array): Promise<{ ok: true; wire: Uint8Array } | { ok: false }> {
  const ciphertext = await currentCiphertext(sql, launchId);
  if (!ciphertext) return { ok: false };
  const opened = openWire(ciphertext, key);
  return opened.ok ? opened : { ok: false };
}

export async function approveRehearsal(input: {
  accountId: string;
  approver: string;
  launchId: string;
  buildId: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const sql = getSql();
  try {
    const build = await loadBuild(sql, input.accountId, input.launchId, input.buildId);
    if (!build || build.scope !== "test") return { ok: false, code: build ? "parent_scope" : "not_found" };
    const parents = await sql<{ mint_address: string }[]>`
      select mint_address from parent_registrations
      where scope = 'test' and symbol = 'TREST' and eligible = true and mint_address = ${build.parentMint}
      limit 1
    `;
    if (!parents[0]) return { ok: false, code: "parent_unregistered" };
    await sql`
      insert into launch_approvals (launch_id, build_id, parent_mint_address, scope, approver_wallet)
      values (${build.launchId}, ${build.buildId}, ${build.parentMint}, 'test', ${input.approver})
      on conflict (launch_id, build_id) do nothing
    `;
    return { ok: true };
  } catch (error) {
    return { ok: false, code: schemaCode(error) === "missing_schema" ? "not_ready" : "unavailable" };
  }
}
