import "server-only";

import { canonicalAddress, decodeSignature, verifySolanaSignature } from "@/lib/auth/solana";
import {
  ABSOLUTE_MS,
  buildSignInMessage,
  CHALLENGE_TTL_MS,
  challengeDecision,
  configuredNetwork,
  sessionDecision,
  sessionMaxAgeSeconds,
} from "@/lib/auth/session";
import {
  createNonce,
  createSessionToken,
  hashRateLimitKey,
  hashSessionToken,
} from "@/lib/auth/token";
import { databaseFailure, getSql } from "@/lib/server/db";
import { readOptionalEnv, requireEnv } from "@/lib/server/env";
import type postgres from "postgres";

export type AccountIdentity = {
  id: string;
  walletAddress: string;
};

export class AuthFlowError extends Error {
  constructor(
    readonly status: 400 | 401 | 429 | 503,
    readonly code: string,
  ) {
    super(code);
  }
}

type ChallengeRow = {
  id: string;
  wallet_address: string;
  domain: string;
  network: string;
  message: string;
  expires_at: Date;
  consumed_at: Date | null;
};

type SessionRow = {
  id: string;
  wallet_address: string;
  last_seen_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionSecret(): string {
  return requireEnv("APP_SESSION_SECRET");
}

function networkName() {
  return configuredNetwork(readOptionalEnv("NEXT_PUBLIC_SOLANA_NETWORK"));
}

async function recordAttempt(bucket: string, limit: number): Promise<void> {
  const sql = getSql();
  await sql`
    delete from auth_attempts
    where id in (
      select id
      from auth_attempts
      where created_at < now() - interval '1 day'
      limit 100
    )
  `;
  await sql`insert into auth_attempts (bucket) values (${bucket})`;
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count
    from auth_attempts
    where bucket = ${bucket}
      and created_at > now() - interval '10 minutes'
  `;
  const count = rows[0]?.count ?? 0;
  if (count > limit) {
    throw new AuthFlowError(429, "rate_limited");
  }
}

export async function createLoginChallenge(input: {
  walletAddress: string;
  domain: string;
  origin: string;
  clientKey: string;
}): Promise<{ challengeId: string; message: string }> {
  const address = canonicalAddress(input.walletAddress);
  if (!address) throw new AuthFlowError(400, "wallet_invalid");
  const secret = sessionSecret();
  const walletBucket = `challenge:wallet:${address}`;
  const ipBucket = `challenge:ip:${hashRateLimitKey(input.clientKey, secret)}`;
  try {
    await recordAttempt(walletBucket, 5);
    await recordAttempt(ipBucket, 20);
    const nonce = createNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    const network = networkName();
    const message = buildSignInMessage({
      domain: input.domain,
      address,
      origin: input.origin,
      network,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
    });
    const rows = await getSql()<{ id: string }[]>`
      insert into login_challenges (
        nonce,
        wallet_address,
        domain,
        network,
        message,
        issued_at,
        expires_at
      )
      values (
        ${nonce},
        ${address},
        ${input.domain},
        ${network},
        ${message},
        ${issuedAt.toISOString()},
        ${expiresAt.toISOString()}
      )
      returning id
    `;
    const challengeId = rows[0]?.id;
    if (!challengeId) throw new AuthFlowError(503, "challenge_unavailable");
    return { challengeId, message };
  } catch (error) {
    if (error instanceof AuthFlowError) throw error;
    const failure = databaseFailure(error);
    throw new AuthFlowError(
      503,
      failure === "missing_schema" ? "schema_missing" : "database_unavailable",
    );
  }
}

export async function verifyLoginChallenge(input: {
  challengeId: string;
  signature: string;
  domain: string;
  clientKey: string;
}): Promise<{ token: string; maxAge: number; account: AccountIdentity }> {
  if (!UUID.test(input.challengeId)) {
    throw new AuthFlowError(400, "challenge_invalid");
  }
  const signature = decodeSignature(input.signature);
  if (!signature) throw new AuthFlowError(400, "signature_invalid");
  const secret = sessionSecret();
  const ipBucket = `verify:ip:${hashRateLimitKey(input.clientKey, secret)}`;
  try {
    await recordAttempt(ipBucket, 30);
    const sql = getSql();
    const issued = await sql.begin(async (tx) => {
      const rows = await tx<ChallengeRow[]>`
        select
          id,
          wallet_address,
          domain,
          network,
          message,
          expires_at,
          consumed_at
        from login_challenges
        where id = ${input.challengeId}::uuid
        for update
      `;
      const challenge = rows[0];
      if (!challenge) throw new AuthFlowError(401, "challenge_rejected");
      await recordAttemptInTransaction(
        tx,
        `verify:wallet:${challenge.wallet_address}`,
        10,
      );
      const decision = challengeDecision({
        now: Date.now(),
        expiresAt: new Date(challenge.expires_at).getTime(),
        consumed: challenge.consumed_at !== null,
        domain: challenge.domain,
        expectedDomain: input.domain,
        network: challenge.network,
        expectedNetwork: networkName(),
      });
      if (decision !== "ok") throw new AuthFlowError(401, "challenge_rejected");
      const valid = verifySolanaSignature(
        challenge.wallet_address,
        challenge.message,
        signature,
      );
      if (!valid) throw new AuthFlowError(401, "signature_rejected");
      const consumed = await tx<{ id: string }[]>`
        update login_challenges
        set consumed_at = now()
        where id = ${challenge.id}::uuid
          and consumed_at is null
        returning id
      `;
      if (!consumed[0]) throw new AuthFlowError(401, "challenge_rejected");
      const accounts = await tx<AccountIdentity[]>`
        insert into accounts (wallet_address)
        values (${challenge.wallet_address})
        on conflict (wallet_address)
        do update set wallet_address = excluded.wallet_address
        returning id, wallet_address as "walletAddress"
      `;
      const account = accounts[0];
      if (!account) throw new AuthFlowError(503, "account_unavailable");
      const token = createSessionToken();
      const now = new Date();
      const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_MS);
      await tx`
        insert into sessions (
          account_id,
          token_hash,
          created_at,
          last_seen_at,
          absolute_expires_at
        )
        values (
          ${account.id}::uuid,
          ${hashSessionToken(token, secret)},
          ${now.toISOString()},
          ${now.toISOString()},
          ${absoluteExpiresAt.toISOString()}
        )
      `;
      return {
        token,
        maxAge: sessionMaxAgeSeconds(now.getTime(), absoluteExpiresAt.getTime()),
        account,
      };
    });
    return issued;
  } catch (error) {
    if (error instanceof AuthFlowError) throw error;
    const failure = databaseFailure(error);
    throw new AuthFlowError(
      503,
      failure === "missing_schema" ? "schema_missing" : "database_unavailable",
    );
  }
}

async function recordAttemptInTransaction(
  tx: postgres.TransactionSql,
  bucket: string,
  limit: number,
): Promise<void> {
  await tx`insert into auth_attempts (bucket) values (${bucket})`;
  const rows = await tx<{ count: number }[]>`
    select count(*)::int as count
    from auth_attempts
    where bucket = ${bucket}
      and created_at > now() - interval '10 minutes'
  `;
  if ((rows[0]?.count ?? 0) > limit) {
    throw new AuthFlowError(429, "rate_limited");
  }
}

export type SessionRead =
  | { state: "anonymous" }
  | { state: "invalid" }
  | {
      state: "active";
      account: AccountIdentity;
      refresh: boolean;
      maxAge: number;
    };

export async function readSession(token: string | undefined): Promise<SessionRead> {
  if (!token) return { state: "anonymous" };
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return { state: "invalid" };
  }
  try {
    const rows = await getSql()<SessionRow[]>`
      select
        a.id,
        a.wallet_address,
        s.last_seen_at,
        s.absolute_expires_at,
        s.revoked_at
      from sessions s
      join accounts a on a.id = s.account_id
      where s.token_hash = ${hashSessionToken(token, secret)}
      limit 1
    `;
    const row = rows[0];
    if (!row) return { state: "invalid" };
    const now = Date.now();
    const decision = sessionDecision({
      now,
      lastSeenAt: new Date(row.last_seen_at).getTime(),
      absoluteExpiresAt: new Date(row.absolute_expires_at).getTime(),
      revoked: row.revoked_at !== null,
    });
    if (decision === "invalid") return { state: "invalid" };
    if (decision === "refresh") {
      await getSql()`
        update sessions
        set last_seen_at = now()
        where token_hash = ${hashSessionToken(token, secret)}
          and revoked_at is null
      `;
    }
    return {
      state: "active",
      account: { id: row.id, walletAddress: row.wallet_address },
      refresh: decision === "refresh",
      maxAge: sessionMaxAgeSeconds(
        now,
        new Date(row.absolute_expires_at).getTime(),
      ),
    };
  } catch (error) {
    console.error(
      `[auth] ${databaseFailure(error) === "missing_schema" ? "schema_missing" : "session_unavailable"}`,
    );
    return { state: "invalid" };
  }
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return;
  }
  try {
    await getSql()`
      update sessions
      set revoked_at = now()
      where token_hash = ${hashSessionToken(token, secret)}
        and revoked_at is null
    `;
  } catch (error) {
    console.error(
      `[auth] ${databaseFailure(error) === "missing_schema" ? "schema_missing" : "logout_unavailable"}`,
    );
  }
}
