import type postgres from "postgres";

import { UNRESOLVED_SUBMISSIONS } from "./post-launch.ts";
import type { SubmissionIntent } from "./submission.ts";
import {
  presentVerifiedLaunch,
  uniqueLaunches,
  type VerificationStamp,
  type VerifiedLaunch,
} from "./verified-launch.ts";

type Sql = postgres.Sql;

export async function writeSubmission(
  sql: Sql,
  input: {
    intent: SubmissionIntent;
    accountId: string;
    ciphertext: string;
    stamp: VerificationStamp;
  },
): Promise<"ok" | "conflict"> {
  const intent = input.intent;
  const stamp = input.stamp;
  const verifiedAt = stamp.verifiedAtMs === null ? null : new Date(stamp.verifiedAtMs);
  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        insert into launch_submissions (
          launch_id, build_id, account_id, wallet_address, child_mint_address, parent_mint_address,
          scope, signature, message_hash, status, wire_ciphertext, slot, verified_at
        ) values (
          ${intent.launchId}, ${intent.buildId}, ${input.accountId}, ${intent.wallet}, ${intent.childMint},
          ${intent.parentMint}, ${intent.scope}, ${intent.signature}, ${intent.messageHash}, ${stamp.status},
          ${input.ciphertext}, ${stamp.slot}, ${verifiedAt}
        )
        on conflict (launch_id) do update
        set status = excluded.status,
            slot = coalesce(launch_submissions.slot, excluded.slot),
            verified_at = coalesce(launch_submissions.verified_at, excluded.verified_at)
        where launch_submissions.signature = excluded.signature
          and launch_submissions.message_hash = excluded.message_hash
          and launch_submissions.build_id = excluded.build_id
          and launch_submissions.child_mint_address = excluded.child_mint_address
        returning id
      `;
      if (!rows[0]) return "conflict" as const;
      if (stamp.attemptStatus !== "verified") return "ok" as const;
      const updated = await tx<{ id: string }[]>`
        update token_launches
        set attempt_status = 'verified',
            attempt_mint_address = ${intent.childMint}
        where id = ${intent.launchId}
          and account_id = ${input.accountId}
          and (attempt_mint_address is null or attempt_mint_address = ${intent.childMint})
        returning id
      `;
      if (!updated[0]) throw new Error("attempt_conflict");
      return "ok" as const;
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "23505" || code === "23514" || code === "attempt_conflict" || message.includes("attempt_conflict")) {
      return "conflict";
    }
    throw error;
  }
}

export async function selectVerifiedLaunches(
  sql: Sql,
  filter: { creator?: string | null; mint?: string | null; scope?: "production" | "test" | null } = {},
): Promise<VerifiedLaunch[]> {
  const creator = filter.creator ?? null;
  const mint = filter.mint ?? null;
  const scope = filter.scope ?? null;
  const rows = await sql<{
    status: string;
    slot: string | null;
    verifiedAt: Date | string | null;
    scope: "production" | "test";
    parentSymbol: "SDK" | "TREST" | null;
    childMint: string;
    parentMint: string;
    name: string;
    symbol: string;
    imageUrl: string | null;
    sdkName: string;
    librarySdkId: string | null;
    creator: string;
    originatorLabel: string;
    signature: string;
  }[]>`
    select
      s.status,
      s.slot::text as slot,
      s.verified_at as "verifiedAt",
      s.scope,
      p.symbol as "parentSymbol",
      s.child_mint_address as "childMint",
      s.parent_mint_address as "parentMint",
      l.token_name as name,
      l.token_symbol as symbol,
      l.image_ipfs_uri as "imageUrl",
      coalesce(lib.name, draft.saved_name, 'Private SDK') as "sdkName",
      l.library_sdk_id as "librarySdkId",
      s.wallet_address as creator,
      l.originator_label as "originatorLabel",
      s.signature
    from launch_submissions s
    join token_launches l on l.id = s.launch_id
    join parent_registrations p
      on p.mint_address = s.parent_mint_address
     and p.scope = s.scope
     and p.eligible = true
     and (
       (s.scope = 'test' and p.symbol = 'TREST')
       or (s.scope = 'production' and p.symbol = 'SDK')
     )
    left join library_sdks lib on lib.id = l.library_sdk_id
    left join sdk_drafts draft on draft.id = l.draft_id
    where s.status in ('verified', 'page_ready')
      and s.slot is not null
      and s.verified_at is not null
      and (${scope}::text is null or s.scope = ${scope})
      and (${creator}::text is null or s.wallet_address = ${creator})
      and (${mint}::text is null or s.child_mint_address = ${mint})
    order by s.verified_at desc, s.child_mint_address
  `;
  const presented = rows.flatMap((row) => {
    const launch = presentVerifiedLaunch({
      ...row,
      slot: row.slot,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
    });
    return launch ? [launch] : [];
  });
  return uniqueLaunches(presented);
}

export async function selectOpenSubmission(
  sql: Sql,
  accountId: string,
): Promise<{
  launchId: string;
  status: string;
  scope: "production" | "test";
  childMint: string;
  parentMint: string;
  signature: string;
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  parentSymbol: "SDK" | "TREST" | null;
} | null> {
  const rows = await sql<{
    launchId: string;
    status: string;
    scope: "production" | "test";
    childMint: string;
    parentMint: string;
    signature: string;
    tokenName: string;
    tokenSymbol: string;
    imageUrl: string | null;
    parentSymbol: "SDK" | "TREST" | null;
  }[]>`
    select
      s.launch_id as "launchId",
      s.status,
      s.scope,
      s.child_mint_address as "childMint",
      s.parent_mint_address as "parentMint",
      s.signature,
      l.token_name as "tokenName",
      l.token_symbol as "tokenSymbol",
      l.image_ipfs_uri as "imageUrl",
      p.symbol as "parentSymbol"
    from launch_submissions s
    join token_launches l on l.id = s.launch_id
    left join parent_registrations p
      on p.mint_address = s.parent_mint_address
     and p.scope = s.scope
    where s.account_id = ${accountId}
      and s.status = any(${UNRESOLVED_SUBMISSIONS})
    order by s.created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}
